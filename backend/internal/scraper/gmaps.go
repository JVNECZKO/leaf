package scraper

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/chromedp/cdproto/fetch"
	"github.com/chromedp/chromedp"
)

var latLngRe = regexp.MustCompile(`@(-?\d+\.\d+),(-?\d+\.\d+)`)

// coordLocRe matches the geohash location format "lat,lng,zoom" (e.g. "52.230000,21.012000,10")
var coordLocRe = regexp.MustCompile(`^(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+)$`)

type Config struct {
	ProxyURL string
	Headless bool
}

type Scraper struct {
	allocCtx   context.Context
	allocCancel context.CancelFunc
	config     Config
}

func New(cfg Config) *Scraper {
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
		opts = append(opts, chromedp.ProxyServer(cfg.ProxyURL))
	}

	if !cfg.Headless {
		opts = append(opts, chromedp.Flag("headless", false))
	}

	if chromePath := os.Getenv("CHROME_PATH"); chromePath != "" {
		opts = append(opts, chromedp.ExecPath(chromePath))
	}

	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)

	return &Scraper{
		allocCtx:    allocCtx,
		allocCancel: allocCancel,
		config:      cfg,
	}
}

func (s *Scraper) Close() {
	s.allocCancel()
}

// Search scrapes all Google Maps results for a given service and location.
func (s *Scraper) Search(ctx context.Context, service, location string, onPlace func(*Place)) error {
	taskCtx, cancel := chromedp.NewContext(s.allocCtx)
	defer cancel()

	timeoutCtx, cancelTimeout := context.WithTimeout(taskCtx, 8*time.Minute)
	defer cancelTimeout()

	var searchURL string
	if m := coordLocRe.FindStringSubmatch(location); m != nil {
		// Geohash/coordinate mode: search near lat,lng at the given zoom level
		searchURL = "https://www.google.com/maps/search/" +
			url.PathEscape(service) + "/@" + m[1] + "," + m[2] + "," + m[3] + "z"
	} else {
		// Text mode: "service location"
		searchURL = "https://www.google.com/maps/search/" + url.PathEscape(service+" "+location)
	}

	log.Printf("[scraper] searching: %q in %q → %s", service, location, searchURL)

	if err := chromedp.Run(timeoutCtx, chromedp.Navigate(searchURL)); err != nil {
		return fmt.Errorf("navigate: %w", err)
	}

	// Accept cookie consent if present
	chromedp.Run(timeoutCtx, acceptCookies())

	// Wait for results feed
	if err := chromedp.Run(timeoutCtx,
		chromedp.WaitVisible(`div[role="feed"]`, chromedp.ByQuery),
	); err != nil {
		// Maybe no results
		return nil
	}

	jitter()

	// Scroll to collect all place URLs
	placeURLs, err := s.collectAllURLs(timeoutCtx)
	if err != nil {
		return err
	}

	log.Printf("[scraper] found %d places for %q in %q", len(placeURLs), service, location)

	// Scrape each place
	for _, placeURL := range placeURLs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		place, err := s.scrapePlaceURL(timeoutCtx, placeURL)
		if err != nil {
			log.Printf("[scraper] error scraping %s: %v", placeURL, err)
			continue
		}
		place.SearchService = service
		place.SearchLocation = location
		onPlace(place)
		jitter()
	}

	return nil
}

func (s *Scraper) collectAllURLs(ctx context.Context) ([]string, error) {
	seen := map[string]bool{}
	noChangeRounds := 0

	for noChangeRounds < 4 {
		var hrefs []string
		if err := chromedp.Run(ctx, chromedp.Evaluate(`
			Array.from(document.querySelectorAll('a[href*="/maps/place/"]'))
				.map(a => a.href.split('?')[0])
				.filter(h => h.includes('/maps/place/'))
		`, &hrefs)); err != nil {
			return nil, err
		}

		prevLen := len(seen)
		for _, h := range hrefs {
			seen[h] = true
		}

		if len(seen) == prevLen {
			noChangeRounds++
		} else {
			noChangeRounds = 0
		}

		// Check if we hit end of results
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

		// Scroll the feed
		chromedp.Run(ctx, chromedp.Evaluate(`
			(() => {
				const feed = document.querySelector('div[role="feed"]');
				if (feed) {
					feed.scrollBy(0, feed.clientHeight * 2);
				}
			})()
		`, nil))

		time.Sleep(time.Duration(1200+rand.Intn(800)) * time.Millisecond)
	}

	result := make([]string, 0, len(seen))
	for u := range seen {
		result = append(result, u)
	}
	return result, nil
}

func (s *Scraper) scrapePlaceURL(ctx context.Context, placeURL string) (*Place, error) {
	place := &Place{MapsURL: placeURL}
	place.PlaceID = extractPlaceID(placeURL)

	if err := chromedp.Run(ctx, chromedp.Navigate(placeURL)); err != nil {
		return nil, err
	}

	// Wait for name to load
	if err := chromedp.Run(ctx, chromedp.WaitVisible(`h1`, chromedp.ByQuery)); err != nil {
		return nil, err
	}

	time.Sleep(800 * time.Millisecond)

	var result map[string]interface{}
	if err := chromedp.Run(ctx, chromedp.Evaluate(`
		(() => {
			const getText = (sel) => {
				const el = document.querySelector(sel);
				return el ? (el.innerText || el.textContent || '').trim() : '';
			};
			const getAttr = (sel, attr) => {
				const el = document.querySelector(sel);
				return el ? (el.getAttribute(attr) || '').trim() : '';
			};

			const name = getText('h1');

			const categoryEl = document.querySelector('button.DkEaL') ||
				document.querySelector('[jsaction*="category"]');
			const category = categoryEl ? categoryEl.innerText.trim() : '';

			const addressBtn = document.querySelector('button[data-item-id="address"]');
			const address = addressBtn ?
				(addressBtn.querySelector('.rogA2c, .Io6YTe')?.innerText || addressBtn.getAttribute('aria-label') || '').replace('Address: ','').trim() : '';

			const phoneBtn = document.querySelector('[data-item-id^="phone:tel:"]');
			const phone = phoneBtn ?
				(phoneBtn.querySelector('.rogA2c, .Io6YTe')?.innerText || phoneBtn.getAttribute('data-item-id')?.replace('phone:tel:','') || '').trim() : '';

			const websiteEl = document.querySelector('a[data-item-id="authority"]');
			const website = websiteEl ? websiteEl.href : '';

			const ratingEl = document.querySelector('.F7nice');
			const rating = ratingEl ? (ratingEl.querySelector('span[aria-hidden="true"]')?.innerText || '').trim() : '';
			const reviewCount = ratingEl ? (ratingEl.querySelector('span[aria-label]')?.innerText || '').replace(/[()]/g,'').trim() : '';

			const hoursEl = document.querySelector('.OMl5r, .t39EBf');
			const hours = hoursEl ? hoursEl.innerText.trim() : '';

			const plusCodeEl = document.querySelector('[data-item-id="oloc"]');
			const plusCode = plusCodeEl ? (plusCodeEl.querySelector('.rogA2c, .Io6YTe')?.innerText || '').trim() : '';

			const urlMatch = window.location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
			const lat = urlMatch ? parseFloat(urlMatch[1]) : 0;
			const lng = urlMatch ? parseFloat(urlMatch[2]) : 0;

			return { name, category, address, phone, website, rating, reviewCount, hours, plusCode, lat, lng, currentURL: window.location.href };
		})()
	`, &result)); err != nil {
		return nil, err
	}

	if result != nil {
		place.Name = safeStr(result["name"])
		place.Category = safeStr(result["category"])
		place.Address = safeStr(result["address"])
		place.Phone = safeStr(result["phone"])
		place.Website = safeStr(result["website"])
		place.Rating = safeStr(result["rating"])
		place.ReviewCount = safeStr(result["reviewCount"])
		place.Hours = safeStr(result["hours"])
		place.PlusCode = safeStr(result["plusCode"])
		place.Latitude = safeFloat(result["lat"])
		place.Longitude = safeFloat(result["lng"])

		// Update maps URL from current page (after any redirects)
		if cu := safeStr(result["currentURL"]); cu != "" {
			place.MapsURL = cu
			if m := latLngRe.FindStringSubmatch(cu); len(m) >= 3 {
				if lat, err := strconv.ParseFloat(m[1], 64); err == nil {
					place.Latitude = lat
				}
				if lng, err := strconv.ParseFloat(m[2], 64); err == nil {
					place.Longitude = lng
				}
			}
		}
	}

	return place, nil
}

func acceptCookies() chromedp.Action {
	return chromedp.ActionFunc(func(ctx context.Context) error {
		// Try different cookie consent button patterns
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
	// Fallback: use the place name from URL
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
