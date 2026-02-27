package worker

import (
	"context"
	"fmt"
	"leaf/internal/db"
	"leaf/internal/enrichment"
	"leaf/internal/geohash"
	"leaf/internal/models"
	"leaf/internal/scraper"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/semaphore"
)

type BroadcastMsg struct {
	Type       string      `json:"type"`
	CampaignID uuid.UUID   `json:"campaign_id"`
	Payload    interface{} `json:"payload"`
}

type batchQueue struct {
	campaignIDs []uuid.UUID
	concurrency int
	mu          sync.Mutex
}

type Manager struct {
	repo      *db.Repository
	enricher  *enrichment.Enricher
	broadcast chan BroadcastMsg
	active    map[uuid.UUID]context.CancelFunc
	mu        sync.Mutex
	// batch queues for Split Mode
	queues   map[uuid.UUID]*batchQueue
	queuesMu sync.Mutex
	// reverse lookup: campaignID → batchID
	campaignBatch   map[uuid.UUID]uuid.UUID
	campaignBatchMu sync.Mutex
}

func NewManager(repo *db.Repository, enrichr *enrichment.Enricher, broadcast chan BroadcastMsg) *Manager {
	m := &Manager{
		repo:          repo,
		enricher:      enrichr,
		broadcast:     broadcast,
		active:        map[uuid.UUID]context.CancelFunc{},
		queues:        map[uuid.UUID]*batchQueue{},
		campaignBatch: map[uuid.UUID]uuid.UUID{},
	}
	go m.enrichmentLoop()
	return m
}

// StartBatch registers a batch and starts up to `concurrency` campaigns immediately.
func (m *Manager) StartBatch(batchID uuid.UUID, campaignIDs []uuid.UUID, concurrency int) {
	if len(campaignIDs) == 0 {
		return
	}
	q := &batchQueue{campaignIDs: campaignIDs, concurrency: concurrency}
	m.queuesMu.Lock()
	m.queues[batchID] = q
	m.queuesMu.Unlock()

	m.campaignBatchMu.Lock()
	for _, id := range campaignIDs {
		m.campaignBatch[id] = batchID
	}
	m.campaignBatchMu.Unlock()

	// Start up to `concurrency` campaigns now
	for i := 0; i < concurrency && i < len(campaignIDs); i++ {
		_ = m.StartCampaign(campaignIDs[i])
	}
}

// onCampaignFinished is called at the end of every runCampaign goroutine.
// If the campaign belongs to a batch queue, it starts the next pending campaign.
func (m *Manager) onCampaignFinished(campaignID uuid.UUID) {
	m.campaignBatchMu.Lock()
	batchID, inBatch := m.campaignBatch[campaignID]
	if inBatch {
		delete(m.campaignBatch, campaignID)
	}
	m.campaignBatchMu.Unlock()

	if !inBatch {
		return
	}

	m.queuesMu.Lock()
	q, ok := m.queues[batchID]
	m.queuesMu.Unlock()
	if !ok {
		return
	}

	q.mu.Lock()
	defer q.mu.Unlock()

	// Count how many in the batch are still running
	m.mu.Lock()
	running := 0
	for _, id := range q.campaignIDs {
		if _, active := m.active[id]; active {
			running++
		}
	}
	m.mu.Unlock()

	// Start next pending campaigns up to concurrency limit
	slots := q.concurrency - running
	for _, id := range q.campaignIDs {
		if slots <= 0 {
			break
		}
		m.mu.Lock()
		_, isActive := m.active[id]
		m.mu.Unlock()
		if isActive {
			continue
		}
		// Check if still pending in DB
		campaign, err := m.repo.GetCampaign(id)
		if err != nil || campaign.Status != "pending" {
			continue
		}
		if err := m.StartCampaign(id); err == nil {
			slots--
		}
	}
}

// buildPool reads proxy settings from DB and creates a Scraper pool for the campaign run.
func (m *Manager) buildPool() *scraper.Pool {
	raw := m.repo.GetSetting("PROXY_LIST", "")
	var proxies []string
	for _, line := range strings.Split(raw, "\n") {
		if p := strings.TrimSpace(line); p != "" {
			proxies = append(proxies, p)
		}
	}
	rotation := m.repo.GetSetting("PROXY_ROTATION", "false") == "true"
	headlessStr := m.repo.GetSetting("HEADLESS", os.Getenv("HEADLESS"))
	headless := headlessStr != "false"
	skipDetail := m.repo.GetSetting("SKIP_DETAIL_PAGES", "false") == "true"
	if len(proxies) > 0 {
		log.Printf("[worker] proxy pool: %d proxies, rotation=%v, skipDetail=%v", len(proxies), rotation, skipDetail)
	}
	return scraper.NewPool(proxies, headless, rotation, skipDetail)
}

func (m *Manager) StartCampaign(campaignID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, running := m.active[campaignID]; running {
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.active[campaignID] = cancel
	go m.runCampaign(ctx, campaignID)
	return nil
}

func (m *Manager) StopCampaign(campaignID uuid.UUID) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if cancel, ok := m.active[campaignID]; ok {
		cancel()
		delete(m.active, campaignID)
	}

	m.repo.UpdateCampaignStatus(campaignID, models.CampaignPaused)
	m.broadcast <- BroadcastMsg{Type: "campaign_paused", CampaignID: campaignID}
}

func (m *Manager) IsCampaignRunning(campaignID uuid.UUID) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.active[campaignID]
	return ok
}

func (m *Manager) runCampaign(ctx context.Context, campaignID uuid.UUID) {
	defer func() {
		m.mu.Lock()
		delete(m.active, campaignID)
		m.mu.Unlock()
		m.onCampaignFinished(campaignID)
	}()

	campaign, err := m.repo.GetCampaign(campaignID)
	if err != nil {
		log.Printf("[worker] campaign %s not found: %v", campaignID, err)
		return
	}

	// Load service/location names — strings only, no 240M task records.
	services, err := m.repo.GetServiceNames(campaignID)
	if err != nil || len(services) == 0 {
		log.Printf("[worker] no services for campaign %s: %v", campaignID, err)
		return
	}

	var locations []string
	if campaign.GeohashMode {
		tiles, tErr := geohash.GenerateTiles(campaign.GeohashArea, uint(campaign.GeohashPrecision))
		if tErr != nil {
			log.Printf("[worker] geohash tile generation failed for campaign %s: %v", campaignID, tErr)
			return
		}
		zoom := geohash.ZoomForPrecision(uint(campaign.GeohashPrecision))
		for _, t := range tiles {
			locations = append(locations, fmt.Sprintf("%.6f,%.6f,%d", t[0], t[1], zoom))
		}
		log.Printf("[worker] geohash mode: %d tiles at precision %d for area %q",
			len(tiles), campaign.GeohashPrecision, campaign.GeohashArea)
	} else {
		locations, err = m.repo.GetLocationNames(campaignID)
		if err != nil || len(locations) == 0 {
			log.Printf("[worker] no locations for campaign %s: %v", campaignID, err)
			return
		}
	}

	log.Printf("[worker] campaign %s: %d services × %d locations = %d pairs (offset %d)",
		campaignID, len(services), len(locations), len(services)*len(locations), campaign.TaskOffset)

	m.repo.UpdateCampaignStatus(campaignID, models.CampaignRunning)
	m.broadcast <- BroadcastMsg{Type: "campaign_started", CampaignID: campaignID}

	pool := m.buildPool()
	defer pool.Close()

	concurrency := campaign.Concurrency
	if concurrency <= 0 {
		concurrency = 2
	}
	if concurrency > 50 {
		log.Printf("[worker] WARNING: concurrency=%d — make sure you have enough RAM/CPU", concurrency)
	}

	sem := semaphore.NewWeighted(int64(concurrency))
	var wg sync.WaitGroup

	nLoc := len(locations)
	startOffset := campaign.TaskOffset
	idx := startOffset

	// O(1) skip to resume position — no brute-force iteration over completed pairs
	svcStart := 0
	locStart := 0
	if startOffset > 0 && nLoc > 0 {
		svcStart = startOffset / nLoc
		locStart = startOffset % nLoc
	}

	for si := svcStart; si < len(services); si++ {
		lStart := 0
		if si == svcStart {
			lStart = locStart
		}
		for li := lStart; li < nLoc; li++ {
			select {
			case <-ctx.Done():
				goto done
			default:
			}

			if err := sem.Acquire(ctx, 1); err != nil {
				goto done
			}

			svc := services[si]
			loc := locations[li]
			wg.Add(1)
			go func(s, l string) {
				defer wg.Done()
				defer sem.Release(1)
				m.runTask(ctx, campaign, s, l, pool)
			}(svc, loc)

			idx++
			// Checkpoint every 500 dispatched pairs for crash recovery
			if idx%500 == 0 {
				m.repo.UpdateCampaignOffset(campaignID, idx)
			}
		}
	}

done:
	wg.Wait()
	// Save final offset so resume works correctly after pause/crash
	m.repo.UpdateCampaignOffset(campaignID, idx)

	if ctx.Err() == nil && idx >= len(services)*nLoc {
		m.repo.UpdateCampaignStatus(campaignID, models.CampaignCompleted)
		m.broadcast <- BroadcastMsg{Type: "campaign_completed", CampaignID: campaignID}
	}
}

func (m *Manager) runTask(ctx context.Context, campaign *models.Campaign, service, location string, pool *scraper.Pool) {
	log.Printf("[worker] task: %q in %q", service, location)

	leadCount := 0

	err := pool.Search(ctx, service, location, func(place *scraper.Place) {
		lead := placeToLead(place, campaign.ID, uuid.Nil)

		if campaign.EnrichmentEnabled && lead.Website != "" {
			lead.EnrichStatus = models.EnrichPending
		} else {
			lead.EnrichStatus = models.EnrichNone
		}

		if err := m.repo.CreateLead(lead); err != nil {
			log.Printf("[worker] save lead error: %v", err)
			return
		}

		m.repo.IncrementCampaignLeads(campaign.ID)
		leadCount++

		m.broadcast <- BroadcastMsg{Type: "lead_found", CampaignID: campaign.ID, Payload: lead}
	})

	if err != nil {
		log.Printf("[worker] task %q/%q failed: %v", service, location, err)
		m.repo.IncrementCampaignFailedTasks(campaign.ID)
	} else {
		m.repo.IncrementCampaignCompletedTasks(campaign.ID)
	}

	m.broadcast <- BroadcastMsg{
		Type:       "task_completed",
		CampaignID: campaign.ID,
		Payload:    map[string]interface{}{"service": service, "location": location, "lead_count": leadCount},
	}
}

func (m *Manager) enrichmentLoop() {
	ticker := time.NewTicker(5 * time.Second)
	resetTicker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	defer resetTicker.Stop()

	for {
		select {
		case <-resetTicker.C:
			// Reset stuck enrichments (processing > 10 min = likely crashed)
			m.repo.ResetStuckEnrichments()

		case <-ticker.C:
			// Read workers count from DB each tick so changes apply without restart
			workers := m.repo.GetSettingInt("ENRICHMENT_WORKERS", enrichmentWorkersFromEnv())

			// GetLeadsForEnrichment atomically marks them as "processing" to avoid duplicates
			leads, err := m.repo.GetLeadsForEnrichment(workers * 2)
			if err != nil || len(leads) == 0 {
				continue
			}

			sem := semaphore.NewWeighted(int64(workers))
			for _, lead := range leads {
				if err := sem.Acquire(context.Background(), 1); err != nil {
					break
				}
				go func(l models.Lead) {
					defer sem.Release(1)
					m.enrichLead(l)
				}(lead)
			}
		}
	}
}

func (m *Manager) enrichLead(lead models.Lead) {
	log.Printf("[enrichment] %s → %s", lead.Name, lead.Website)

	result, err := m.enricher.EnrichWebsite(lead.Website)
	if err != nil {
		log.Printf("[enrichment] error for %s: %v", lead.Website, err)
		lead.EnrichStatus = models.EnrichFailed
		m.repo.UpdateLead(&lead)
		return
	}
	if result == nil {
		lead.EnrichStatus = models.EnrichFailed
		m.repo.UpdateLead(&lead)
		return
	}

	emails, social := m.enricher.SerializeResult(result)
	if len(result.Emails) > 0 {
		lead.Email = result.Emails[0]
		log.Printf("[enrichment] found email for %s: %s", lead.Name, lead.Email)
	} else {
		log.Printf("[enrichment] no email found for %s (%s)", lead.Name, lead.Website)
	}

	// Phone from website takes priority; fallback is the Maps card phone (already in lead.Phone)
	if len(result.Phones) > 0 {
		lead.Phone = result.Phones[0]
		log.Printf("[enrichment] found phone for %s: %s", lead.Name, lead.Phone)
	}

	lead.ExtraEmails = emails
	lead.SocialLinks = social
	lead.EnrichStatus = models.EnrichDone

	if err := m.repo.UpdateLead(&lead); err != nil {
		log.Printf("[enrichment] update error: %v", err)
		return
	}

	m.broadcast <- BroadcastMsg{
		Type:       "lead_enriched",
		CampaignID: lead.CampaignID,
		Payload:    lead,
	}
}

func placeToLead(p *scraper.Place, campaignID, taskID uuid.UUID) *models.Lead {
	return &models.Lead{
		CampaignID:     campaignID,
		TaskID:         taskID,
		Name:           p.Name,
		Category:       p.Category,
		Address:        p.Address,
		Phone:          p.Phone,
		Website:        p.Website,
		Rating:         p.Rating,
		ReviewCount:    p.ReviewCount,
		MapsURL:        p.MapsURL,
		PlaceID:        p.PlaceID,
		Latitude:       p.Latitude,
		Longitude:      p.Longitude,
		Hours:          p.Hours,
		PlusCode:       p.PlusCode,
		SearchService:  p.SearchService,
		SearchLocation: p.SearchLocation,
	}
}

func enrichmentWorkersFromEnv() int {
	v := os.Getenv("ENRICHMENT_WORKERS")
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return 10
	}
	return n
}
