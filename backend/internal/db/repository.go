package db

import (
	"leaf/internal/models"
	"strconv"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// --- Campaign ---

func (r *Repository) CreateCampaign(c *models.Campaign) error {
	return r.db.Create(c).Error
}

func (r *Repository) GetCampaign(id uuid.UUID) (*models.Campaign, error) {
	var c models.Campaign
	// Preload only Services (small set). Locations may be 60k+ rows — return count instead.
	err := r.db.Preload("Services").First(&c, "id = ?", id).Error
	if err == nil {
		r.db.Model(&models.Location{}).Where("campaign_id = ?", id).Count(&c.LocationsCount)
	}
	return &c, err
}

func (r *Repository) GetServiceNames(campaignID uuid.UUID) ([]string, error) {
	var names []string
	return names, r.db.Model(&models.Service{}).
		Where("campaign_id = ?", campaignID).
		Pluck("name", &names).Error
}

func (r *Repository) GetLocationNames(campaignID uuid.UUID) ([]string, error) {
	var names []string
	return names, r.db.Model(&models.Location{}).
		Where("campaign_id = ?", campaignID).
		Pluck("name", &names).Error
}

func (r *Repository) UpdateCampaignOffset(id uuid.UUID, offset int) error {
	return r.db.Model(&models.Campaign{}).Where("id = ?", id).
		Update("task_offset", offset).Error
}

func (r *Repository) ListCampaigns() ([]models.Campaign, error) {
	var campaigns []models.Campaign
	err := r.db.Order("created_at desc").Find(&campaigns).Error
	return campaigns, err
}

func (r *Repository) ListCampaignsPaginated(page, pageSize int) ([]models.Campaign, int64, error) {
	var campaigns []models.Campaign
	var total int64
	r.db.Model(&models.Campaign{}).Count(&total)
	offset := (page - 1) * pageSize
	err := r.db.Order("created_at desc").Offset(offset).Limit(pageSize).Find(&campaigns).Error
	return campaigns, total, err
}

func (r *Repository) UpdateCampaign(c *models.Campaign) error {
	return r.db.Save(c).Error
}

func (r *Repository) UpdateCampaignStatus(id uuid.UUID, status models.CampaignStatus) error {
	return r.db.Model(&models.Campaign{}).Where("id = ?", id).Update("status", status).Error
}

func (r *Repository) IncrementCampaignLeads(id uuid.UUID) error {
	return r.db.Model(&models.Campaign{}).Where("id = ?", id).
		UpdateColumn("total_leads", gorm.Expr("total_leads + 1")).Error
}

func (r *Repository) IncrementCampaignCompletedTasks(id uuid.UUID) error {
	return r.db.Model(&models.Campaign{}).Where("id = ?", id).
		UpdateColumn("completed_tasks", gorm.Expr("completed_tasks + 1")).Error
}

func (r *Repository) IncrementCampaignFailedTasks(id uuid.UUID) error {
	return r.db.Model(&models.Campaign{}).Where("id = ?", id).
		UpdateColumn("failed_tasks", gorm.Expr("failed_tasks + 1")).Error
}

func (r *Repository) DeleteCampaign(id uuid.UUID) error {
	r.db.Where("campaign_id = ?", id).Delete(&models.Lead{})
	r.db.Where("campaign_id = ?", id).Delete(&models.Task{})
	r.db.Where("campaign_id = ?", id).Delete(&models.Service{})
	r.db.Where("campaign_id = ?", id).Delete(&models.Location{})
	return r.db.Delete(&models.Campaign{}, "id = ?", id).Error
}

func (r *Repository) DeleteAllCampaigns() (int64, error) {
	sess := r.db.Session(&gorm.Session{AllowGlobalUpdate: true})
	sess.Delete(&models.Lead{})
	sess.Delete(&models.Task{})
	sess.Delete(&models.Service{})
	sess.Delete(&models.Location{})
	res := sess.Delete(&models.Campaign{})
	return res.RowsAffected, res.Error
}

func (r *Repository) CreateServices(services []models.Service) error {
	if len(services) == 0 {
		return nil
	}
	return r.db.CreateInBatches(services, 100).Error
}

func (r *Repository) CreateLocations(locations []models.Location) error {
	if len(locations) == 0 {
		return nil
	}
	return r.db.CreateInBatches(locations, 100).Error
}

// --- Tasks ---

func (r *Repository) CreateTasks(tasks []models.Task) error {
	return r.db.CreateInBatches(tasks, 100).Error
}

func (r *Repository) GetPendingTasks(campaignID uuid.UUID) ([]models.Task, error) {
	var tasks []models.Task
	err := r.db.Where("campaign_id = ? AND status = ?", campaignID, models.TaskPending).Find(&tasks).Error
	return tasks, err
}

func (r *Repository) UpdateTaskStatus(id uuid.UUID, status models.TaskStatus, errMsg string) error {
	updates := map[string]interface{}{"status": status}
	if errMsg != "" {
		updates["error_msg"] = errMsg
	}
	return r.db.Model(&models.Task{}).Where("id = ?", id).Updates(updates).Error
}

func (r *Repository) IncrementTaskLeads(id uuid.UUID) error {
	return r.db.Model(&models.Task{}).Where("id = ?", id).
		UpdateColumn("lead_count", gorm.Expr("lead_count + 1")).Error
}

func (r *Repository) ListTasks(campaignID uuid.UUID) ([]models.Task, error) {
	var tasks []models.Task
	err := r.db.Where("campaign_id = ?", campaignID).Order("created_at asc").Find(&tasks).Error
	return tasks, err
}

func (r *Repository) ListTasksPaginated(campaignID uuid.UUID, status string, page, pageSize int) ([]models.Task, int64, error) {
	var tasks []models.Task
	var total int64
	q := r.db.Model(&models.Task{}).Where("campaign_id = ?", campaignID)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	q.Count(&total)
	offset := (page - 1) * pageSize
	err := q.Order("created_at asc").Offset(offset).Limit(pageSize).Find(&tasks).Error
	return tasks, total, err
}

// --- Leads ---

func (r *Repository) CreateLead(l *models.Lead) error {
	return r.db.Create(l).Error
}

func (r *Repository) UpdateLead(l *models.Lead) error {
	return r.db.Save(l).Error
}

func (r *Repository) GetLead(id uuid.UUID) (*models.Lead, error) {
	var l models.Lead
	err := r.db.First(&l, "id = ?", id).Error
	return &l, err
}

func (r *Repository) ListLeads(filter LeadFilter) ([]models.Lead, int64, error) {
	var leads []models.Lead
	var total int64

	q := r.db.Model(&models.Lead{}).
		Select("leads.*, campaigns.name AS campaign_name").
		Joins("LEFT JOIN campaigns ON campaigns.id = leads.campaign_id")

	if filter.CampaignID != uuid.Nil {
		q = q.Where("leads.campaign_id = ?", filter.CampaignID)
	}
	if filter.CampaignName != "" {
		q = q.Where("campaigns.name ILIKE ?", "%"+filter.CampaignName+"%")
	}
	if filter.SearchService != "" {
		q = q.Where("leads.search_service ILIKE ?", "%"+filter.SearchService+"%")
	}
	if filter.Search != "" {
		q = q.Where("leads.name ILIKE ? OR leads.email ILIKE ? OR leads.phone ILIKE ? OR leads.address ILIKE ?",
			"%"+filter.Search+"%", "%"+filter.Search+"%", "%"+filter.Search+"%", "%"+filter.Search+"%")
	}
	if filter.HasEmail {
		q = q.Where("leads.email != ''")
	}
	if filter.HasPhone {
		q = q.Where("leads.phone != ''")
	}
	if filter.HasWebsite {
		q = q.Where("leads.website != ''")
	}

	q.Count(&total)

	offset := (filter.Page - 1) * filter.PageSize
	err := q.Order("leads.created_at desc").Offset(offset).Limit(filter.PageSize).Scan(&leads).Error
	return leads, total, err
}

// GetLeadsForEnrichment atomically claims leads for processing to avoid duplicates.
func (r *Repository) GetLeadsForEnrichment(limit int) ([]models.Lead, error) {
	var leads []models.Lead
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Where("website != '' AND email = '' AND enrich_status = ?", models.EnrichPending).
			Limit(limit).
			Find(&leads).Error; err != nil {
			return err
		}
		if len(leads) == 0 {
			return nil
		}
		ids := make([]string, len(leads))
		for i, l := range leads {
			ids[i] = l.ID.String()
		}
		return tx.Model(&models.Lead{}).
			Where("id IN ?", ids).
			Update("enrich_status", models.EnrichProcessing).Error
	})
	return leads, err
}

// ResetStuckEnrichments resets processing → pending for leads stuck > 10min.
func (r *Repository) ResetStuckEnrichments() error {
	return r.db.Model(&models.Lead{}).
		Where("enrich_status = ? AND updated_at < NOW() - INTERVAL '10 minutes'", models.EnrichProcessing).
		Update("enrich_status", models.EnrichPending).Error
}

func (r *Repository) GetStats() (*models.Stats, error) {
	var stats models.Stats
	r.db.Model(&models.Campaign{}).Count(&stats.TotalCampaigns)
	r.db.Model(&models.Campaign{}).Where("status = ?", models.CampaignRunning).Count(&stats.RunningCampaigns)
	r.db.Model(&models.Lead{}).Count(&stats.TotalLeads)
	r.db.Model(&models.Lead{}).Where("email != ''").Count(&stats.TotalWithEmail)
	r.db.Model(&models.Lead{}).Where("phone != ''").Count(&stats.TotalWithPhone)
	r.db.Model(&models.Lead{}).Where("enrich_status = ?", models.EnrichDone).Count(&stats.TotalEnriched)
	return &stats, nil
}

type LeadFilter struct {
	CampaignID    uuid.UUID
	CampaignName  string
	SearchService string
	Search        string
	HasEmail      bool
	HasPhone      bool
	HasWebsite    bool
	Page          int
	PageSize      int
}

// --- Settings ---

func (r *Repository) GetAllSettings() ([]models.Setting, error) {
	var settings []models.Setting
	return settings, r.db.Order("key").Find(&settings).Error
}

func (r *Repository) GetSetting(key, fallback string) string {
	var s models.Setting
	if err := r.db.First(&s, "key = ?", key).Error; err != nil {
		return fallback
	}
	if s.Value == "" {
		return fallback
	}
	return s.Value
}

func (r *Repository) GetSettingInt(key string, fallback int) int {
	var s models.Setting
	if err := r.db.First(&s, "key = ?", key).Error; err != nil {
		return fallback
	}
	n, err := strconv.Atoi(s.Value)
	if err != nil || n < 1 {
		return fallback
	}
	return n
}

func (r *Repository) UpsertSettings(updates map[string]string) error {
	for key, value := range updates {
		s := models.Setting{Key: key, Value: value}
		if err := r.db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"value"}),
		}).Create(&s).Error; err != nil {
			return err
		}
	}
	return nil
}

// --- Lead deletion ---

func (r *Repository) DeleteLead(id uuid.UUID) error {
	return r.db.Delete(&models.Lead{}, "id = ?", id).Error
}

func (r *Repository) DeleteLeads(ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	return r.db.Delete(&models.Lead{}, "id IN ?", ids).Error
}

// --- Users ---

func (r *Repository) GetUserByEmail(email string) (*models.User, error) {
	var user models.User
	return &user, r.db.Where("email = ?", email).First(&user).Error
}

// --- Predefined Services ---

func (r *Repository) ListPredefinedServices() ([]models.PredefinedService, error) {
	var services []models.PredefinedService
	return services, r.db.Order("name asc").Find(&services).Error
}

func (r *Repository) CreatePredefinedServices(services []models.PredefinedService) error {
	if len(services) == 0 {
		return nil
	}
	// Skip duplicates on unique name constraint
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(services, 100).Error
}

func (r *Repository) DeletePredefinedServices(ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	return r.db.Delete(&models.PredefinedService{}, "id IN ?", ids).Error
}

// --- Campaign batch (Split Mode) ---

func (r *Repository) ListCampaignsByBatch(batchID uuid.UUID) ([]models.Campaign, error) {
	var campaigns []models.Campaign
	return campaigns, r.db.Where("batch_id = ?", batchID).Order("queue_position asc").Find(&campaigns).Error
}

func (r *Repository) CountRunningInBatch(batchID uuid.UUID) (int64, error) {
	var count int64
	return count, r.db.Model(&models.Campaign{}).
		Where("batch_id = ? AND status = ?", batchID, models.CampaignRunning).
		Count(&count).Error
}

func (r *Repository) GetNextQueuedInBatch(batchID uuid.UUID) (*models.Campaign, error) {
	var c models.Campaign
	err := r.db.Where("batch_id = ? AND status = ?", batchID, models.CampaignPending).
		Order("queue_position asc").
		First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) UpdateCampaignFields(id uuid.UUID, name string, concurrency int, enrichment bool) error {
	return r.db.Model(&models.Campaign{}).Where("id = ?", id).Updates(map[string]interface{}{
		"name":               name,
		"concurrency":        concurrency,
		"enrichment_enabled": enrichment,
	}).Error
}

func (r *Repository) ListRunningCampaignIDs() ([]uuid.UUID, error) {
	var ids []uuid.UUID
	return ids, r.db.Model(&models.Campaign{}).Where("status = ?", models.CampaignRunning).Pluck("id", &ids).Error
}
