package scraper

import (
	"context"
	"sync"
)

// Pool holds multiple Scraper instances and routes Search calls between them.
// When rotation is enabled, it round-robins across all scrapers.
// When rotation is disabled, it always uses the first scraper.
type Pool struct {
	scrapers []*Scraper
	rotation bool
	mu       sync.Mutex
	idx      int
}

// NewPool creates one Scraper per proxy URL.
// If proxyURLs is empty, one Scraper without a proxy is created.
func NewPool(proxyURLs []string, headless, rotation bool) *Pool {
	if len(proxyURLs) == 0 {
		proxyURLs = []string{""}
	}
	scrapers := make([]*Scraper, 0, len(proxyURLs))
	for _, u := range proxyURLs {
		scrapers = append(scrapers, New(Config{ProxyURL: u, Headless: headless}))
	}
	return &Pool{scrapers: scrapers, rotation: rotation}
}

// Search routes the request to the next available scraper.
func (p *Pool) Search(ctx context.Context, service, location string, onPlace func(*Place)) error {
	var s *Scraper
	if p.rotation && len(p.scrapers) > 1 {
		p.mu.Lock()
		s = p.scrapers[p.idx%len(p.scrapers)]
		p.idx++
		p.mu.Unlock()
	} else {
		s = p.scrapers[0]
	}
	return s.Search(ctx, service, location, onPlace)
}

// Close shuts down all underlying scrapers.
func (p *Pool) Close() {
	for _, s := range p.scrapers {
		s.Close()
	}
}
