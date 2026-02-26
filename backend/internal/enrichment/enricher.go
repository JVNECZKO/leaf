package enrichment

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

var (
	emailRe = regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)
	atRe    = regexp.MustCompile(`([a-zA-Z0-9._%+\-]+)\s*[\[\(]?\s*(?:at|AT|@)\s*[\]\)]?\s*([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})`)

	ignoredEmailDomains = map[string]bool{
		"example.com": true, "sentry.io": true, "wixpress.com": true,
		"amazonaws.com": true, "cloudflare.com": true, "sendgrid.net": true,
		"mailchimp.com": true, "githubusercontent.com": true, "schema.org": true,
		"w3.org": true, "google.com": true, "apple.com": true,
		"facebook.com": true, "twitter.com": true, "instagram.com": true,
		"wordpress.com": true, "jquery.com": true, "acquia.com": true,
		"placeholder.com": true, "yourdomain.com": true, "domain.com": true,
		"email.com": true, "user.com": true, "test.com": true,
	}

	socialDomains = []string{
		"facebook.com", "fb.com", "instagram.com", "twitter.com", "x.com",
		"linkedin.com", "youtube.com", "tiktok.com", "pinterest.com", "yelp.com",
	}

	contactKeywords = []string{
		"contact", "kontakt", "about", "impressum", "reach-us", "get-in-touch",
		"team", "support", "help", "o-nas", "reach", "talk-to-us",
		"our-team", "write-us",
	}

	requestHeaders = http.Header{
		"User-Agent":                {"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"},
		"Accept":                    {"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"},
		"Accept-Language":           {"en-US,en;q=0.9"},
		"DNT":                       {"1"},
		"Upgrade-Insecure-Requests": {"1"},
	}
)

type Result struct {
	Emails      []string
	SocialLinks []string
	Phones      []string
}

type Enricher struct {
	client *http.Client
}

func New(proxyURL string) *Enricher {
	transport := &http.Transport{
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
		DisableKeepAlives:   false,
		MaxIdleConns:        50,
		MaxIdleConnsPerHost: 5,
	}
	if proxyURL != "" {
		if p, err := url.Parse(proxyURL); err == nil {
			transport.Proxy = http.ProxyURL(p)
		}
	}
	return &Enricher{
		client: &http.Client{Timeout: 20 * time.Second, Transport: transport},
	}
}

// EnrichWebsite scrapes the site and common sub-pages to find emails and social links.
func (e *Enricher) EnrichWebsite(websiteURL string) (*Result, error) {
	if websiteURL == "" {
		return nil, nil
	}

	websiteURL = normalizeURL(websiteURL)
	baseURL, err := url.Parse(websiteURL)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}

	result := &Result{}
	seenEmails := map[string]bool{}
	seenSocial := map[string]bool{}
	seenPhones := map[string]bool{}

	// Start with main page + pre-computed contact paths
	toVisit := []string{websiteURL}
	for _, path := range []string{
		"/contact", "/contact-us", "/contacts",
		"/about", "/about-us",
		"/impressum", "/kontakt", "/kontakty",
		"/reach-us", "/get-in-touch",
		"/team", "/our-team",
		"/help", "/support",
	} {
		toVisit = append(toVisit, baseURL.Scheme+"://"+baseURL.Host+path)
	}

	visited := map[string]bool{}

	for i := 0; i < len(toVisit) && i < 30; i++ {
		u := normalizeURL(toVisit[i])
		if u == "" || visited[u] {
			continue
		}
		visited[u] = true

		doc, finalHost, err := e.fetchDoc(u)
		if err != nil {
			continue
		}

		// Scan <a href> for mailto, tel and social links
		doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
			href, _ := s.Attr("href")
			href = strings.TrimSpace(href)
			if href == "" {
				return
			}
			lower := strings.ToLower(href)

			// mailto:
			if strings.HasPrefix(lower, "mailto:") {
				email := parseMailto(href)
				if email != "" && isValidEmail(email) && !seenEmails[email] {
					seenEmails[email] = true
					result.Emails = append(result.Emails, email)
				}
				return
			}

			// tel: links — most reliable phone source
			if strings.HasPrefix(lower, "tel:") {
				phone := normalizePhone(strings.TrimPrefix(lower, "tel:"))
				if phone != "" && !seenPhones[phone] {
					seenPhones[phone] = true
					result.Phones = append(result.Phones, phone)
				}
				return
			}

			// Social links
			for _, domain := range socialDomains {
				if strings.Contains(href, domain) {
					abs := makeAbsURL(baseURL, href)
					if abs != "" && !seenSocial[abs] {
						seenSocial[abs] = true
						result.SocialLinks = append(result.SocialLinks, abs)
					}
				}
			}

			// Discover more contact pages (only from first 3 pages visited)
			if i < 3 {
				abs := makeAbsURL(baseURL, href)
				if abs != "" && !visited[abs] &&
					isSameDomain(finalHost, abs) &&
					isContactLink(href, s.Text()) {
					toVisit = append(toVisit, abs)
				}
			}
		})

		// schema.org microdata — itemprop="telephone"
		doc.Find("[itemprop='telephone']").Each(func(_ int, s *goquery.Selection) {
			phone := normalizePhone(s.Text())
			if phone != "" && !seenPhones[phone] {
				seenPhones[phone] = true
				result.Phones = append(result.Phones, phone)
			}
		})

		// Scan page HTML for email patterns — but strip <script> and <style> first
		// to avoid false positives from JS code (e.g. dataLayer.push, foo@bar.call)
		doc.Find("script, style, noscript").Remove()
		html, err := doc.Html()
		if err == nil {
			for _, email := range emailRe.FindAllString(html, -1) {
				email = strings.ToLower(strings.TrimSpace(email))
				if isValidEmail(email) && !seenEmails[email] {
					seenEmails[email] = true
					result.Emails = append(result.Emails, email)
				}
			}
		}

		// Scan page text for obfuscated emails: "info [at] example.com"
		text := doc.Text()
		for _, m := range atRe.FindAllStringSubmatch(text, -1) {
			if len(m) >= 3 {
				email := strings.ToLower(m[1] + "@" + m[2])
				if isValidEmail(email) && !seenEmails[email] {
					seenEmails[email] = true
					result.Emails = append(result.Emails, email)
				}
			}
		}
	}

	result.Emails = prioritizeEmails(result.Emails, baseURL.Host)
	return result, nil
}

func (e *Enricher) fetchDoc(pageURL string) (*goquery.Document, string, error) {
	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header = requestHeaders.Clone()

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	doc, err := goquery.NewDocumentFromReader(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil, "", err
	}

	finalHost := ""
	if resp.Request != nil && resp.Request.URL != nil {
		finalHost = resp.Request.URL.Host
	}

	return doc, finalHost, nil
}

func (e *Enricher) SerializeResult(r *Result) (emails string, social string) {
	if r == nil {
		return "", ""
	}
	if len(r.Emails) > 0 {
		b, _ := json.Marshal(r.Emails)
		emails = string(b)
	}
	if len(r.SocialLinks) > 0 {
		b, _ := json.Marshal(r.SocialLinks)
		social = string(b)
	}
	return
}

// --- helpers ---

func normalizeURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		raw = "https://" + raw
	}
	return raw
}

func parseMailto(href string) string {
	email := strings.TrimPrefix(strings.TrimPrefix(href, "mailto:"), "MAILTO:")
	email = strings.Split(email, "?")[0]
	return strings.ToLower(strings.TrimSpace(email))
}

func makeAbsURL(base *url.URL, href string) string {
	href = strings.TrimSpace(href)
	if href == "" || strings.HasPrefix(href, "#") ||
		strings.HasPrefix(href, "javascript:") ||
		strings.HasPrefix(href, "mailto:") ||
		strings.HasPrefix(href, "tel:") {
		return ""
	}
	ref, err := url.Parse(href)
	if err != nil {
		return ""
	}
	return base.ResolveReference(ref).String()
}

func isSameDomain(host, absURL string) bool {
	if host == "" {
		return true
	}
	u, err := url.Parse(absURL)
	if err != nil {
		return false
	}
	strip := func(h string) string { return strings.TrimPrefix(strings.ToLower(h), "www.") }
	return strip(u.Host) == strip(host)
}

func normalizePhone(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	for i, c := range s {
		switch {
		case c == '+' && i == 0:
			b.WriteRune(c)
		case c >= '0' && c <= '9':
			b.WriteRune(c)
		case (c == ' ' || c == '-' || c == '.' || c == '(' || c == ')') && b.Len() > 0:
			b.WriteRune(c)
		}
	}
	out := strings.TrimSpace(b.String())
	digits := 0
	for _, c := range out {
		if c >= '0' && c <= '9' {
			digits++
		}
	}
	if digits < 7 || digits > 15 {
		return ""
	}
	return out
}

func isContactLink(href, text string) bool {
	lower := strings.ToLower(href + " " + text)
	for _, kw := range contactKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

func isValidEmail(email string) bool {
	if len(email) < 6 || len(email) > 120 {
		return false
	}
	if !strings.Contains(email, "@") {
		return false
	}
	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	domain := strings.ToLower(parts[1])
	if !strings.Contains(domain, ".") {
		return false
	}
	if strings.ContainsAny(email, " \t\n\r") {
		return false
	}
	// Filter file extensions and common JS method names used as fake TLDs
	for _, ext := range []string{
		".png", ".jpg", ".gif", ".svg", ".css", ".js", ".webp", ".ico",
		".push", ".call", ".apply", ".bind", ".map", ".filter", ".find",
		".join", ".sort", ".trim", ".split", ".replace", ".match", ".exec",
		".then", ".catch", ".next", ".done", ".fail", ".log", ".error",
		".min", ".max", ".floor", ".ceil", ".round",
	} {
		if strings.HasSuffix(domain, ext) {
			return false
		}
	}
	// Block single-char local part (like d@alayer.push)
	if len(parts[0]) < 2 {
		return false
	}
	if ignoredEmailDomains[domain] {
		return false
	}
	if strings.Contains(parts[0], "/") {
		return false
	}
	return true
}

func prioritizeEmails(emails []string, siteHost string) []string {
	if len(emails) == 0 {
		return emails
	}
	site := strings.TrimPrefix(strings.ToLower(siteHost), "www.")

	type scored struct {
		email string
		score int
	}
	list := make([]scored, 0, len(emails))
	for _, em := range emails {
		s := 0
		parts := strings.SplitN(em, "@", 2)
		if len(parts) == 2 {
			d := strings.TrimPrefix(strings.ToLower(parts[1]), "www.")
			if d == site {
				s += 100
			}
			l := strings.ToLower(parts[0])
			switch l {
			case "info", "contact", "hello", "office", "mail", "biuro", "kontakt", "hi":
				s += 10
			case "admin", "webmaster", "noreply", "no-reply", "donotreply", "bounce":
				s -= 20
			}
		}
		list = append(list, scored{em, s})
	}
	for i := 0; i < len(list)-1; i++ {
		for j := i + 1; j < len(list); j++ {
			if list[j].score > list[i].score {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	out := make([]string, len(list))
	for i, s := range list {
		out[i] = s.email
	}

	_ = log.Printf
	return out
}
