package api

import (
	"crypto/rand"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"leaf/internal/db"
	"leaf/internal/geohash"
	"leaf/internal/hub"
	"leaf/internal/models"
	"leaf/internal/worker"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type Server struct {
	repo      *db.Repository
	manager   *worker.Manager
	hub       *hub.Hub
	engine    *gin.Engine
	jwtSecret []byte
}

func New(repo *db.Repository, mgr *worker.Manager, h *hub.Hub) *Server {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Disposition"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		log.Println("[auth] WARNING: JWT_SECRET not set — using random secret (all sessions reset on restart)")
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		secret = hex.EncodeToString(b)
	}

	s := &Server{repo: repo, manager: mgr, hub: h, engine: r, jwtSecret: []byte(secret)}
	s.registerRoutes()
	return s
}

// --- JWT helpers ---

type jwtClaims struct {
	UserID uuid.UUID `json:"user_id"`
	Email  string    `json:"email"`
	jwt.RegisteredClaims
}

func (s *Server) generateToken(userID uuid.UUID, email string) (string, error) {
	claims := jwtClaims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.jwtSecret)
}

func (s *Server) parseToken(tokenStr string) (*jwtClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &jwtClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return s.jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*jwtClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}

func (s *Server) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		var tokenStr string
		if auth := c.GetHeader("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			tokenStr = strings.TrimPrefix(auth, "Bearer ")
		} else {
			tokenStr = c.Query("token") // WebSocket connections pass token as query param
		}
		if tokenStr == "" {
			c.AbortWithStatusJSON(401, gin.H{"error": "unauthorized"})
			return
		}
		claims, err := s.parseToken(tokenStr)
		if err != nil {
			c.AbortWithStatusJSON(401, gin.H{"error": "invalid or expired token"})
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("user_email", claims.Email)
		c.Next()
	}
}

func (s *Server) Run(addr string) error {
	return s.engine.Run(addr)
}

// --- Auth ---

func (s *Server) login(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	user, err := s.repo.GetUserByEmail(req.Email)
	if err != nil {
		c.JSON(401, gin.H{"error": "invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(401, gin.H{"error": "invalid credentials"})
		return
	}

	token, err := s.generateToken(user.ID, user.Email)
	if err != nil {
		c.JSON(500, gin.H{"error": "could not generate token"})
		return
	}

	c.JSON(200, gin.H{"token": token})
}

func (s *Server) registerRoutes() {
	// Public routes
	s.engine.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	s.engine.POST("/api/auth/login", s.login)

	// Protected routes
	api := s.engine.Group("/api", s.authMiddleware())

	// Stats
	api.GET("/stats", s.getStats)

	// Campaigns
	api.GET("/campaigns", s.listCampaigns)
	api.POST("/campaigns", s.createCampaign)
	api.GET("/campaigns/:id", s.getCampaign)
	api.DELETE("/campaigns/:id", s.deleteCampaign)
	api.POST("/campaigns/:id/start", s.startCampaign)
	api.POST("/campaigns/:id/stop", s.stopCampaign)
	api.GET("/campaigns/:id/tasks", s.getCampaignTasks)

	// Leads
	api.GET("/leads", s.listLeads)
	api.GET("/leads/export", s.exportLeads)
	api.DELETE("/leads", s.deleteLeads)
	api.DELETE("/leads/:id", s.deleteLead)
	api.GET("/campaigns/:id/leads", s.getCampaignLeads)
	api.GET("/campaigns/:id/leads/export", s.exportCampaignLeads)

	// Geohash
	api.GET("/geohash/tiles", s.getGeohashTileCount)

	// Settings
	api.GET("/settings", s.getSettings)
	api.PUT("/settings", s.updateSettings)

	// WebSocket — token via ?token= query param
	s.engine.GET("/ws", s.authMiddleware(), func(c *gin.Context) {
		s.hub.ServeWS(c.Writer, c.Request)
	})
}

// --- Stats ---

func (s *Server) getStats(c *gin.Context) {
	stats, err := s.repo.GetStats()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, stats)
}

// --- Campaigns ---

func (s *Server) listCampaigns(c *gin.Context) {
	campaigns, err := s.repo.ListCampaigns()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, campaigns)
}

type CreateCampaignRequest struct {
	Name              string   `json:"name" binding:"required"`
	Services          []string `json:"services" binding:"required,min=1"`
	Locations         []string `json:"locations"`
	Concurrency       int      `json:"concurrency"`
	EnrichmentEnabled *bool    `json:"enrichment_enabled"`
	// Geohash mode — mutually exclusive with Locations
	GeohashMode      bool   `json:"geohash_mode"`
	GeohashArea      string `json:"geohash_area"`
	GeohashPrecision int    `json:"geohash_precision"`
}

func (s *Server) createCampaign(c *gin.Context) {
	var req CreateCampaignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	if req.Concurrency <= 0 {
		req.Concurrency = 2
	}

	enrichEnabled := true
	if req.EnrichmentEnabled != nil {
		enrichEnabled = *req.EnrichmentEnabled
	}

	precision := req.GeohashPrecision
	if req.GeohashMode {
		if req.GeohashArea == "" {
			c.JSON(400, gin.H{"error": "geohash_area is required when geohash_mode is true"})
			return
		}
		if precision < 1 || precision > 9 {
			precision = 4
		}
	} else {
		if len(req.Locations) == 0 {
			c.JSON(400, gin.H{"error": "locations are required when geohash_mode is false"})
			return
		}
	}

	campaign := &models.Campaign{
		Name:              req.Name,
		Status:            models.CampaignPending,
		Concurrency:       req.Concurrency,
		EnrichmentEnabled: enrichEnabled,
		GeohashMode:       req.GeohashMode,
		GeohashArea:       req.GeohashArea,
		GeohashPrecision:  precision,
	}

	services := dedup(req.Services)

	if req.GeohashMode {
		tiles, err := geohash.GenerateTiles(req.GeohashArea, uint(precision))
		if err != nil {
			c.JSON(400, gin.H{"error": fmt.Sprintf("invalid geohash area: %v", err)})
			return
		}
		campaign.TotalTasks = len(services) * len(tiles)
	} else {
		locations := dedup(req.Locations)
		campaign.TotalTasks = len(services) * len(locations)

		if err := s.repo.CreateCampaign(campaign); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		var svcModels []models.Service
		for _, svc := range services {
			svcModels = append(svcModels, models.Service{CampaignID: campaign.ID, Name: svc})
		}
		var locModels []models.Location
		for _, loc := range locations {
			locModels = append(locModels, models.Location{CampaignID: campaign.ID, Name: loc})
		}
		_ = s.repo.CreateServices(svcModels)
		_ = s.repo.CreateLocations(locModels)

		c.JSON(201, campaign)
		return
	}

	if err := s.repo.CreateCampaign(campaign); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	// Geohash mode: store only services, tiles are generated dynamically at runtime
	var svcModels []models.Service
	for _, svc := range services {
		svcModels = append(svcModels, models.Service{CampaignID: campaign.ID, Name: svc})
	}
	_ = s.repo.CreateServices(svcModels)

	// Tasks are generated dynamically during execution — no pre-creation needed.
	c.JSON(201, campaign)
}

func (s *Server) getCampaign(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}

	campaign, err := s.repo.GetCampaign(id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(404, gin.H{"error": "not found"})
		} else {
			c.JSON(500, gin.H{"error": err.Error()})
		}
		return
	}

	campaign.Status = func() models.CampaignStatus {
		if s.manager.IsCampaignRunning(id) {
			return models.CampaignRunning
		}
		return campaign.Status
	}()

	c.JSON(200, campaign)
}

func (s *Server) deleteCampaign(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}

	s.manager.StopCampaign(id)

	if err := s.repo.DeleteCampaign(id); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{"ok": true})
}

func (s *Server) startCampaign(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}

	if err := s.manager.StartCampaign(id); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{"ok": true, "status": "running"})
}

func (s *Server) stopCampaign(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}

	s.manager.StopCampaign(id)
	c.JSON(200, gin.H{"ok": true, "status": "paused"})
}

func (s *Server) getCampaignTasks(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}

	tasks, err := s.repo.ListTasks(id)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, tasks)
}

// --- Leads ---

func (s *Server) listLeads(c *gin.Context) {
	filter := buildLeadFilter(c, uuid.Nil)
	leads, total, err := s.repo.ListLeads(filter)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{
		"data":      leads,
		"total":     total,
		"page":      filter.Page,
		"page_size": filter.PageSize,
	})
}

func (s *Server) getCampaignLeads(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}

	filter := buildLeadFilter(c, id)
	leads, total, err := s.repo.ListLeads(filter)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{
		"data":      leads,
		"total":     total,
		"page":      filter.Page,
		"page_size": filter.PageSize,
	})
}

func (s *Server) exportLeads(c *gin.Context) {
	s.exportLeadsInternal(c, uuid.Nil)
}

func (s *Server) exportCampaignLeads(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}
	s.exportLeadsInternal(c, id)
}

func (s *Server) exportLeadsInternal(c *gin.Context, campaignID uuid.UUID) {
	filter := buildLeadFilter(c, campaignID)
	filter.Page = 1
	filter.PageSize = 100000

	leads, _, err := s.repo.ListLeads(filter)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	filename := fmt.Sprintf("leads_%s.csv", time.Now().Format("2006-01-02"))
	c.Header("Content-Disposition", "attachment; filename="+filename)
	c.Header("Content-Type", "text/csv; charset=utf-8")

	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{
		"Name", "Category", "Address", "Phone", "Email", "Website",
		"Rating", "Reviews", "Search Service", "Search Location",
		"Latitude", "Longitude", "Maps URL", "Hours",
	})

	for _, l := range leads {
		w.Write([]string{
			l.Name, l.Category, l.Address, l.Phone, l.Email, l.Website,
			l.Rating, l.ReviewCount, l.SearchService, l.SearchLocation,
			strconv.FormatFloat(l.Latitude, 'f', 6, 64),
			strconv.FormatFloat(l.Longitude, 'f', 6, 64),
			l.MapsURL, l.Hours,
		})
	}
	w.Flush()
}

func buildLeadFilter(c *gin.Context, campaignID uuid.UUID) db.LeadFilter {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 1000 {
		pageSize = 50
	}

	return db.LeadFilter{
		CampaignID: campaignID,
		Search:     c.Query("search"),
		HasEmail:   c.Query("has_email") == "true",
		HasPhone:   c.Query("has_phone") == "true",
		HasWebsite: c.Query("has_website") == "true",
		Page:       page,
		PageSize:   pageSize,
	}
}

func (s *Server) deleteLead(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}
	if err := s.repo.DeleteLead(id); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (s *Server) deleteLeads(c *gin.Context) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	ids := make([]uuid.UUID, 0, len(req.IDs))
	for _, raw := range req.IDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			continue
		}
		ids = append(ids, id)
	}
	if err := s.repo.DeleteLeads(ids); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true, "deleted": len(ids)})
}

// --- Geohash ---

func (s *Server) getGeohashTileCount(c *gin.Context) {
	area := c.Query("area")
	precisionStr := c.DefaultQuery("precision", "4")
	if area == "" {
		c.JSON(400, gin.H{"error": "area is required"})
		return
	}
	precision, err := strconv.Atoi(precisionStr)
	if err != nil || precision < 1 || precision > 9 {
		c.JSON(400, gin.H{"error": "precision must be 1–9"})
		return
	}
	tiles, err := geohash.GenerateTiles(area, uint(precision))
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"count": len(tiles)})
}

// --- Settings ---

func (s *Server) getSettings(c *gin.Context) {
	settings, err := s.repo.GetAllSettings()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, settings)
}

func (s *Server) updateSettings(c *gin.Context) {
	var updates map[string]string
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if err := s.repo.UpsertSettings(updates); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func dedup(items []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item != "" && !seen[strings.ToLower(item)] {
			seen[strings.ToLower(item)] = true
			result = append(result, item)
		}
	}
	return result
}
