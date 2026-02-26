package scraper

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/fetch"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"
)

var latLngRe = regexp.MustCompile(`@(-?\d+\.\d+),(-?\d+\.\d+)`)
var coordLocRe = regexp.MustCompile(`^(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+)$`)

// maxParallelTabs is the number of concurrent tabs used to fetch
// individual place pages (for website URL). Higher values = faster
// but more memory and higher detection risk.
const maxParallelTabs = 4

type Config struct {
	ProxyURL string
	Headless bool
}

type Scraper struct {
	allocCtx      context.Context
	allocCancel   context.CancelFunc
	browserCtx    context.Context
	browserCancel context.CancelFunc
	config        Config
	proxyUser     string
	proxyPass     string
}

// listItem holds data extracted from a single search result card
// without navigating to the individual place page.
type listItem struct {
	PlaceURL    string
	Name        string
	Website     string // present when Google shows it in the list card
	Phone       string
	Rating      string
	ReviewCount string
	Lat         float64
	Lng         float64
}

// placeDetail holds data fetched from the individual Google Maps place page.
type placeDetail struct {
	Website  string
	Category string
	Address  string
	Phone    string
	Lat      float64
	Lng      float64
	MapsURL  string
}

func New(cfg Config) *Scraper {
	var proxyUser, proxyPass string

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("disable-blink-features", "AutomationControlled"),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-setuid-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("disable-web-security", false),
		chromedp.Flag("disable-extensions", true),
		chromedp.Flag("disable-default-apps", true),
		chromedp.Flag("mute-audio", true),
		chromedp.Flag("no-first-run", true),
		chromedp.Flag("no-default-browser-check", true),
		chromedp.Flag("password-store", "basic"),
		chromedp.Flag("use-mock-keychain", true),
		chromedp.Flag("disable-background-timer-throttling", true),
		chromedp.Flag("disable-renderer-backgrounding", true),
		chromedp.Flag("disable-backgrounding-occluded-windows", true),
		chromedp.UserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"),
		chromedp.WindowSize(1920, 1080),
	)

	if cfg.ProxyURL != "" {
		proxyHost := cfg.ProxyURL
		if u, err := url.Parse(cfg.ProxyURL); err == nil && u.User != nil {
			proxyUser = u.User.Username()
			proxyPass, _ = u.User.Password()
			u.User = nil
			proxyHost = u.String()
		}
		opts = append(opts, chromedp.ProxyServer(proxyHost))
		if proxyUser != "" {
			log.Printf("[scraper] proxy configured with auth (user: %s)", proxyUser)
		}
	}

	if !cfg.Headless {
		opts = append(opts, chromedp.Flag("headless", false))
	}

	if chromePath := os.Getenv("CHROME_PATH"); chromePath != "" {
		opts = append(opts, chromedp.ExecPath(chromePath))
	}

	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)

	// Start ONE browser process per Scraper and keep it alive.
	// Each Search() call opens a tab in this process instead of spawning a new browser.
	browserCtx, browserCancel := chromedp.NewContext(allocCtx, chromedp.WithLogf(log.Printf))
	if err := chromedp.Run(browserCtx); err != nil {
		log.Printf("[scraper] browser start error: %v", err)
	}

	return &Scraper{
		allocCtx:      allocCtx,
		allocCancel:   allocCancel,
		browserCtx:    browserCtx,
		browserCancel: browserCancel,
		config:        cfg,
		proxyUser:     proxyUser,
		proxyPass:     proxyPass,
	}
}

func (s *Scraper) Close() {
	s.browserCancel()
	s.allocCancel()
}

// enableFetch activates the CDP Fetch domain on ctx to:
//  1. Block images, fonts, and media — saves bandwidth and speeds up loading.
//  2. Handle proxy authentication challenges (when credentials are configured).
func (s *Scraper) enableFetch(ctx context.Context) {
	chromedp.ListenTarget(ctx, func(ev interface{}) {
		switch e := ev.(type) {
		case *fetch.EventAuthRequired:
			if s.proxyUser == "" {
				return
			}
			go func() {
				c := chromedp.FromContext(ctx)
				ctx2 := cdp.WithExecutor(ctx, c.Target)
				_ = fetch.ContinueWithAuth(e.RequestID, &fetch.AuthChallengeResponse{
					Response: fetch.AuthChallengeResponseResponseProvideCredentials,
					Username: s.proxyUser,
					Password: s.proxyPass,
				}).Do(ctx2)
			}()
		case *fetch.EventRequestPaused:
			go func() {
				c := chromedp.FromContext(ctx)
				ctx2 := cdp.WithExecutor(ctx, c.Target)
				switch e.ResourceType {
				case network.ResourceTypeImage,
					network.ResourceTypeFont,
					network.ResourceTypeMedia:
					_ = fetch.FailRequest(e.RequestID, network.ErrorReasonBlockedByClient).Do(ctx2)
				default:
					_ = fetch.ContinueRequest(e.RequestID).Do(ctx2)
				}
			}()
		}
	})
	if err := chromedp.Run(ctx, fetch.Enable().WithHandleAuthRequests(s.proxyUser != "")); err != nil {
		log.Printf("[scraper] fetch.Enable: %v", err)
	}
}

// Search scrapes Google Maps results for the given service + location.
//
// Strategy:
//  1. Load the search results page and scroll until all cards are loaded.
//  2. Extract place data directly from the list cards (name, coords, website
//     when shown in card, phone, rating). No per-place page navigation needed
//     for this phase — much faster than the old approach.
//  3. For places whose website URL was NOT found in the list card, open
//     their individual Google Maps page in parallel (up to maxParallelTabs
//     concurrent tabs) and extract just the website + category + address.
//  4. Call onPlace for each place as soon as its data is complete.
func (s *Scraper) Search(ctx context.Context, service, location string, onPlace func(*Place)) error {
	// Phase 1: collect all place data from the search results list.
	items, err := s.collectFromList(ctx, service, location)
	if err != nil {
		return err
	}

	log.Printf("[scraper] found %d places for %q in %q", len(items), service, location)
	if len(items) == 0 {
		return nil
	}

	// Phase 2: for places without a website from the list, fetch individual pages in parallel.
	sem := make(chan struct{}, maxParallelTabs)
	var wg sync.WaitGroup
	var mu sync.Mutex // guards onPlace (called from goroutines)

	for _, item := range items {
		select {
		case <-ctx.Done():
			wg.Wait()
			return ctx.Err()
		default:
		}

		wg.Add(1)
		go func(it listItem) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			place := itemToPlace(it, service, location)

			if it.Website == "" {
				detail := s.fetchPlaceDetail(ctx, it.PlaceURL)
				if detail.Website != "" {
					place.Website = detail.Website
				}
				if detail.Category != "" {
					place.Category = detail.Category
				}
				if detail.Address != "" {
					place.Address = detail.Address
				}
				if detail.Phone != "" && place.Phone == "" {
					place.Phone = detail.Phone
				}
				if detail.Lat != 0 {
					place.Latitude = detail.Lat
					place.Longitude = detail.Lng
				}
				if detail.MapsURL != "" {
					place.MapsURL = detail.MapsURL
					if m := latLngRe.FindStringSubmatch(detail.MapsURL); len(m) >= 3 {
						if lat, err := strconv.ParseFloat(m[1], 64); err == nil {
							place.Latitude = lat
						}
						if lng, err := strconv.ParseFloat(m[2], 64); err == nil {
							place.Longitude = lng
						}
					}
				}
			}

			mu.Lock()
			onPlace(place)
			mu.Unlock()
			jitter()
		}(item)
	}

	wg.Wait()
	return nil
}

// collectFromList navigates to the Google Maps search results page, scrolls
// until all results are loaded, and extracts place data from every card.
// The search tab is opened, used, and closed within this function.
func (s *Scraper) collectFromList(ctx context.Context, service, location string) ([]listItem, error) {
	tabCtx, cancel := chromedp.NewContext(s.browserCtx)
	defer cancel()

	tCtx, tCancel := context.WithTimeout(tabCtx, 10*time.Minute)
	defer tCancel()

	s.enableFetch(tCtx)

	var searchURL string
	if m := coordLocRe.FindStringSubmatch(location); m != nil {
		searchURL = "https://www.google.com/maps/search/" +
			url.PathEscape(service) + "/@" + m[1] + "," + m[2] + "," + m[3] + "z"
	} else {
		searchURL = "https://www.google.com/maps/search/" + url.PathEscape(service+" "+location)
	}

	log.Printf("[scraper] searching: %q in %q → %s", service, location, searchURL)

	if err := chromedp.Run(tCtx, chromedp.Navigate(searchURL)); err != nil {
		return nil, fmt.Errorf("navigate: %w", err)
	}

	chromedp.Run(tCtx, acceptCookies())

	if err := chromedp.Run(tCtx,
		chromedp.WaitVisible(`div[role="feed"]`, chromedp.ByQuery),
	); err != nil {
		// No results for this search — not an error
		return nil, nil
	}

	jitter()
	return scrollAndExtract(tCtx)
}

// extractJS runs inside Google Maps search results and returns all visible
// place cards as JSON. It extracts every piece of data available in the list
// view without navigating to individual place pages.
const extractJS = `JSON.stringify((() => {
	const feed = document.querySelector('div[role="feed"]');
	if (!feed) return [];
	const results = [];
	const seen = new Set();

	feed.querySelectorAll('a[href*="/maps/place/"]').forEach(link => {
		const raw = link.href;
		const href = raw.split('?')[0];
		if (!href || seen.has(href)) return;
		seen.add(href);

		// Walk up to find the direct child of the feed element (the card root)
		let card = link;
		while (card.parentElement && card.parentElement !== feed) {
			card = card.parentElement;
		}

		// Name: aria-label on the primary place link is the most stable source
		const name = link.getAttribute('aria-label') || '';

		// Coords embedded in the href
		const cm = raw.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
		const lat = cm ? parseFloat(cm[1]) : 0;
		const lng = cm ? parseFloat(cm[2]) : 0;

		// Website: any non-Google external link inside the card
		// (Google sometimes shows a "Website" button linking directly to the business)
		let website = '';
		card.querySelectorAll('a[href]').forEach(a => {
			if (website) return;
			const h = a.href || '';
			if (h.startsWith('http') &&
				!h.includes('google.com') &&
				!h.includes('goo.gl') &&
				!h.includes('/maps/')) {
				website = h;
			}
		});

		// Phone: check for data-item-id pattern (present in some cards)
		let phone = '';
		const phoneEl = card.querySelector('[data-item-id^="phone:tel:"]');
		if (phoneEl) {
			phone = (phoneEl.getAttribute('data-item-id') || '').replace('phone:tel:', '');
		}

		// Rating: find "X.X" pattern in span text (e.g. "4.3", "3,7")
		let rating = '';
		let reviewCount = '';
		card.querySelectorAll('span').forEach(span => {
			if (rating && reviewCount) return;
			const t = (span.innerText || '').trim();
			if (!rating && /^\d[.,]\d$/.test(t)) {
				rating = t.replace(',', '.');
				return;
			}
			if (!reviewCount && /^\([\d,.]+\)$/.test(t)) {
				reviewCount = t.replace(/[(),.\s]/g, '');
			}
		});

		results.push({ href, name, website, phone, rating, reviewCount, lat, lng });
	});

	return results;
})())`

// scrollAndExtract scrolls the Google Maps feed until all results are loaded,
// running the extraction JS after each scroll to pick up new cards.
func scrollAndExtract(ctx context.Context) ([]listItem, error) {
	seen := map[string]bool{}
	var items []listItem
	noChangeRounds := 0

	for noChangeRounds < 4 {
		var jsonStr string
		if err := chromedp.Run(ctx, chromedp.Evaluate(extractJS, &jsonStr)); err != nil {
			return nil, fmt.Errorf("extract list: %w", err)
		}

		var raw []struct {
			Href        string  `json:"href"`
			Name        string  `json:"name"`
			Website     string  `json:"website"`
			Phone       string  `json:"phone"`
			Rating      string  `json:"rating"`
			ReviewCount string  `json:"reviewCount"`
			Lat         float64 `json:"lat"`
			Lng         float64 `json:"lng"`
		}
		if jsonStr != "" && jsonStr != "null" {
			_ = json.Unmarshal([]byte(jsonStr), &raw)
		}

		prevLen := len(items)
		for _, r := range raw {
			if r.Href == "" || seen[r.Href] {
				continue
			}
			seen[r.Href] = true
			items = append(items, listItem{
				PlaceURL:    r.Href,
				Name:        r.Name,
				Website:     r.Website,
				Phone:       r.Phone,
				Rating:      r.Rating,
				ReviewCount: r.ReviewCount,
				Lat:         r.Lat,
				Lng:         r.Lng,
			})
		}

		if len(items) == prevLen {
			noChangeRounds++
		} else {
			noChangeRounds = 0
		}

		// Check if the feed has reached its end
		var endFound bool
		chromedp.Run(ctx, chromedp.Evaluate(`
			(() => {
				const feed = document.querySelector('div[role="feed"]');
				if (!feed) return true;
				const text = feed.innerText || '';
				return text.includes("You've reached the end") ||
					   text.includes("Results end") ||
					   document.querySelector('.HlvSq') !== null;
			})()
		`, &endFound))
		if endFound {
			break
		}

		// Scroll to load more results
		chromedp.Run(ctx, chromedp.Evaluate(`
			(() => {
				const feed = document.querySelector('div[role="feed"]');
				if (feed) feed.scrollBy(0, feed.clientHeight * 2);
			})()
		`, nil))

		time.Sleep(time.Duration(1200+rand.Intn(800)) * time.Millisecond)
	}

	return items, nil
}

// fetchPlaceDetail opens a Google Maps place page in a new tab and extracts
// the website URL, category, address, and phone. Called only for places whose
// website was not found in the search results list card.
//
// Uses polling instead of fixed sleeps: checks up to 5 times with 300 ms
// intervals (max ~1.5 s wait) instead of the old 800 ms fixed sleep.
func (s *Scraper) fetchPlaceDetail(ctx context.Context, placeURL string) placeDetail {
	tabCtx, cancel := chromedp.NewContext(s.browserCtx)
	defer cancel()

	tCtx, tCancel := context.WithTimeout(tabCtx, 15*time.Second)
	defer tCancel()

	s.enableFetch(tCtx)

	var result placeDetail

	if err := chromedp.Run(tCtx, chromedp.Navigate(placeURL)); err != nil {
		return result
	}

	// Wait for h1 — signals the place page has rendered its core content
	if err := chromedp.Run(tCtx, chromedp.WaitVisible(`h1`, chromedp.ByQuery)); err != nil {
		return result
	}

	const detailJS = `JSON.stringify((() => {
		const websiteEl  = document.querySelector('a[data-item-id="authority"]');
		const addressBtn = document.querySelector('button[data-item-id="address"]');
		const phoneBtn   = document.querySelector('[data-item-id^="phone:tel:"]');
		const categoryEl = document.querySelector('button.DkEaL') ||
		                   document.querySelector('[jsaction*="category"]');
		const urlMatch   = window.location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
		return {
			website:  websiteEl  ? websiteEl.href : '',
			address:  addressBtn ? (addressBtn.querySelector('.rogA2c,.Io6YTe')?.innerText || '').trim() : '',
			phone:    phoneBtn   ? (
				phoneBtn.querySelector('.rogA2c,.Io6YTe')?.innerText ||
				phoneBtn.getAttribute('data-item-id')?.replace('phone:tel:','') || ''
			).trim() : '',
			category: categoryEl ? categoryEl.innerText.trim() : '',
			lat: urlMatch ? parseFloat(urlMatch[1]) : 0,
			lng: urlMatch ? parseFloat(urlMatch[2]) : 0,
			url: window.location.href,
		};
	})())`

	// Poll up to ~1.5 s for the page data to be available.
	// This replaces the old fixed 800 ms sleep — we stop as soon as we have data.
	for i := 0; i < 5; i++ {
		select {
		case <-ctx.Done():
			return result
		case <-tCtx.Done():
			return result
		default:
		}

		var jsonStr string
		if err := chromedp.Run(tCtx, chromedp.Evaluate(detailJS, &jsonStr)); err == nil && jsonStr != "" && jsonStr != "null" {
			var data struct {
				Website  string  `json:"website"`
				Address  string  `json:"address"`
				Phone    string  `json:"phone"`
				Category string  `json:"category"`
				Lat      float64 `json:"lat"`
				Lng      float64 `json:"lng"`
				URL      string  `json:"url"`
			}
			if err := json.Unmarshal([]byte(jsonStr), &data); err == nil {
				result = placeDetail{
					Website:  data.Website,
					Address:  data.Address,
					Phone:    data.Phone,
					Category: data.Category,
					Lat:      data.Lat,
					Lng:      data.Lng,
					MapsURL:  data.URL,
				}
				// Stop polling as soon as we have the critical fields
				if result.Website != "" || result.Address != "" || result.Category != "" {
					break
				}
			}
		}

		time.Sleep(300 * time.Millisecond)
	}

	return result
}

// itemToPlace converts a listItem (from search results) into a Place.
func itemToPlace(item listItem, service, location string) *Place {
	p := &Place{
		MapsURL:        item.PlaceURL,
		Name:           item.Name,
		Website:        item.Website,
		Phone:          item.Phone,
		Rating:         item.Rating,
		ReviewCount:    item.ReviewCount,
		Latitude:       item.Lat,
		Longitude:      item.Lng,
		PlaceID:        extractPlaceID(item.PlaceURL),
		SearchService:  service,
		SearchLocation: location,
	}
	// Coords in the list href may be imprecise — refine from the URL pattern
	if item.Lat == 0 {
		if m := latLngRe.FindStringSubmatch(item.PlaceURL); len(m) >= 3 {
			if lat, err := strconv.ParseFloat(m[1], 64); err == nil {
				p.Latitude = lat
			}
			if lng, err := strconv.ParseFloat(m[2], 64); err == nil {
				p.Longitude = lng
			}
		}
	}
	return p
}

func acceptCookies() chromedp.Action {
	return chromedp.ActionFunc(func(ctx context.Context) error {
		selectors := []string{
			`button[aria-label="Accept all"]`,
			`button[aria-label="Alle akzeptieren"]`,
			`button[aria-label="Tout accepter"]`,
			`form[action*="consent"] button`,
			`#L2AGLb`,
		}
		for _, sel := range selectors {
			var exists bool
			if err := chromedp.Run(ctx, chromedp.Evaluate(fmt.Sprintf(
				`!!document.querySelector('%s')`, sel,
			), &exists)); err == nil && exists {
				chromedp.Run(ctx, chromedp.Click(sel, chromedp.ByQuery))
				time.Sleep(500 * time.Millisecond)
				return nil
			}
		}
		return nil
	})
}

func jitter() {
	time.Sleep(time.Duration(300+rand.Intn(700)) * time.Millisecond)
}

func extractPlaceID(placeURL string) string {
	re := regexp.MustCompile(`!1s(0x[0-9a-f]+:[0-9a-fx]+)`)
	if m := re.FindStringSubmatch(placeURL); len(m) > 1 {
		return m[1]
	}
	parts := strings.Split(placeURL, "/maps/place/")
	if len(parts) > 1 {
		name := strings.Split(parts[1], "/")[0]
		decoded, err := url.PathUnescape(name)
		if err != nil {
			return name
		}
		return decoded
	}
	return ""
}

func safeStr(v interface{}) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func safeFloat(v interface{}) float64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case float64:
		return val
	case string:
		f, _ := strconv.ParseFloat(val, 64)
		return f
	}
	return 0
}
