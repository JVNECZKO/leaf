package geohash

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/mmcloughlin/geohash"
)

// known named regions: minLat, maxLat, minLng, maxLng
var regions = map[string][4]float64{
	"usa":    {24.5, 49.4, -124.7, -66.9},
	"poland": {49.0, 54.9, 14.1, 24.2},
	"eu":     {34.5, 71.2, -10.6, 34.6},
}

// ParseArea resolves an area name ("usa", "poland", "eu") or a custom
// "minLat,maxLat,minLng,maxLng" string into bounding-box coordinates.
func ParseArea(area string) (minLat, maxLat, minLng, maxLng float64, err error) {
	if bbox, ok := regions[strings.ToLower(strings.TrimSpace(area))]; ok {
		return bbox[0], bbox[1], bbox[2], bbox[3], nil
	}

	parts := strings.SplitN(area, ",", 4)
	if len(parts) != 4 {
		return 0, 0, 0, 0, fmt.Errorf("unknown area %q — use a region name or 'minLat,maxLat,minLng,maxLng'", area)
	}
	vals := make([]float64, 4)
	for i, p := range parts {
		v, e := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if e != nil {
			return 0, 0, 0, 0, fmt.Errorf("invalid coordinate in area %q: %w", area, e)
		}
		vals[i] = v
	}
	return vals[0], vals[1], vals[2], vals[3], nil
}

// GenerateTiles returns the centers of all geohash tiles at the given precision
// that cover the bounding box of the specified area.
// Tiles are enumerated row by row (south→north, west→east).
func GenerateTiles(area string, precision uint) ([][2]float64, error) {
	if precision < 1 || precision > 9 {
		return nil, fmt.Errorf("precision must be between 1 and 9, got %d", precision)
	}

	minLat, maxLat, minLng, maxLng, err := ParseArea(area)
	if err != nil {
		return nil, err
	}

	var tiles [][2]float64

	lat := minLat
	for lat <= maxLat {
		// Get the tile height for this row from the first tile in the row
		ghRow := geohash.EncodeWithPrecision(lat, minLng, precision)
		boxRow := geohash.BoundingBox(ghRow)
		rowNextLat := boxRow.MaxLat + 1e-9

		lng := minLng
		for lng <= maxLng {
			gh := geohash.EncodeWithPrecision(lat, lng, precision)
			box := geohash.BoundingBox(gh)
			centerLat := (box.MinLat + box.MaxLat) / 2
			centerLng := (box.MinLng + box.MaxLng) / 2
			tiles = append(tiles, [2]float64{centerLat, centerLng})
			lng = box.MaxLng + 1e-9
		}

		lat = rowNextLat
	}

	return tiles, nil
}

// ZoomForPrecision returns a Google Maps zoom level appropriate for the given
// geohash precision. The zoom must be ≥ 12 so that Google Maps renders the
// search-results feed (div[role="feed"]); lower values show a map-only view
// with no business listings.
func ZoomForPrecision(precision uint) int {
	switch precision {
	case 1, 2, 3:
		return 12 // broad coverage; feed still appears at 12
	case 4:
		return 12 // ~39 km tile — zoom 12 shows ~20 km area, feed reliable
	case 5:
		return 13 // ~4.8 km tile
	case 6:
		return 14 // ~1.2 km tile
	default:
		return 13
	}
}

// KnownRegions returns the list of predefined region names.
func KnownRegions() []string {
	result := make([]string, 0, len(regions))
	for k := range regions {
		result = append(result, k)
	}
	return result
}
