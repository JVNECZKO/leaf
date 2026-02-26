package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type CampaignStatus string
type TaskStatus string
type EnrichStatus string

const (
	CampaignPending   CampaignStatus = "pending"
	CampaignRunning   CampaignStatus = "running"
	CampaignPaused    CampaignStatus = "paused"
	CampaignCompleted CampaignStatus = "completed"
	CampaignFailed    CampaignStatus = "failed"

	TaskPending   TaskStatus = "pending"
	TaskRunning   TaskStatus = "running"
	TaskCompleted TaskStatus = "completed"
	TaskFailed    TaskStatus = "failed"

	EnrichNone       EnrichStatus = "none"
	EnrichPending    EnrichStatus = "pending"
	EnrichProcessing EnrichStatus = "processing"
	EnrichDone       EnrichStatus = "done"
	EnrichFailed     EnrichStatus = "failed"
)

type Campaign struct {
	ID                uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	Name              string         `gorm:"not null" json:"name"`
	Status            CampaignStatus `gorm:"default:'pending'" json:"status"`
	Concurrency       int            `gorm:"default:2" json:"concurrency"`
	ProxyURL          string         `json:"proxy_url,omitempty"`
	EnrichmentEnabled bool           `gorm:"default:true" json:"enrichment_enabled"`
	TotalTasks        int            `gorm:"default:0" json:"total_tasks"`
	CompletedTasks    int            `gorm:"default:0" json:"completed_tasks"`
	FailedTasks       int            `gorm:"default:0" json:"failed_tasks"`
	TotalLeads        int            `gorm:"default:0" json:"total_leads"`
	TaskOffset        int            `gorm:"default:0" json:"task_offset"`
	// Geohash mode: instead of storing Location records, tiles are generated on-the-fly
	GeohashMode      bool   `gorm:"default:false" json:"geohash_mode"`
	GeohashArea      string `json:"geohash_area,omitempty"` // "usa","poland","eu" or "minLat,maxLat,minLng,maxLng"
	GeohashPrecision int    `gorm:"default:4" json:"geohash_precision"`
	// Batch/Split Mode: campaigns created together share a batch_id
	BatchID       *uuid.UUID `gorm:"type:uuid;index" json:"batch_id,omitempty"`
	QueuePosition int        `gorm:"default:0" json:"queue_position"`
	// Services are loaded (small set); Locations count is computed to avoid loading 60k+ rows
	Services       []Service `gorm:"foreignKey:CampaignID" json:"services,omitempty"`
	LocationsCount int64     `gorm:"-" json:"locations_count"`
	Tasks          []Task    `gorm:"foreignKey:CampaignID" json:"-"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (c *Campaign) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

type Service struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	CampaignID uuid.UUID `gorm:"type:uuid;not null" json:"campaign_id"`
	Name       string    `gorm:"not null" json:"name"`
}

func (s *Service) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

type Location struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	CampaignID uuid.UUID `gorm:"type:uuid;not null" json:"campaign_id"`
	Name       string    `gorm:"not null" json:"name"`
}

func (l *Location) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	return nil
}

type Task struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	CampaignID uuid.UUID  `gorm:"type:uuid;not null;index" json:"campaign_id"`
	Service    string     `gorm:"not null" json:"service"`
	Location   string     `gorm:"not null" json:"location"`
	Status     TaskStatus `gorm:"default:'pending'" json:"status"`
	ErrorMsg   string     `json:"error_msg,omitempty"`
	LeadCount  int        `gorm:"default:0" json:"lead_count"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (t *Task) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	return nil
}

type Lead struct {
	ID            uuid.UUID    `gorm:"type:uuid;primaryKey" json:"id"`
	CampaignID    uuid.UUID    `gorm:"type:uuid;not null;index" json:"campaign_id"`
	TaskID        uuid.UUID    `gorm:"type:uuid;not null;index" json:"task_id"`
	Name          string       `json:"name"`
	Category      string       `json:"category"`
	Address       string       `json:"address"`
	Phone         string       `json:"phone"`
	Email         string       `json:"email"`
	Website       string       `json:"website"`
	Rating        string       `json:"rating"`
	ReviewCount   string       `json:"review_count"`
	MapsURL       string       `json:"maps_url"`
	PlaceID       string       `gorm:"index" json:"place_id"`
	Latitude      float64      `json:"latitude"`
	Longitude     float64      `json:"longitude"`
	Hours         string       `json:"hours"`
	PlusCode      string       `json:"plus_code"`
	SocialLinks   string       `gorm:"type:text" json:"social_links"` // JSON array
	ExtraEmails   string       `gorm:"type:text" json:"extra_emails"` // JSON array
	EnrichStatus   EnrichStatus `gorm:"default:'none'" json:"enrich_status"`
	SearchService  string       `json:"search_service"`
	SearchLocation string       `json:"search_location"`
	CampaignName   string       `gorm:"-" json:"campaign_name,omitempty"` // populated via JOIN, not stored
	CreatedAt      time.Time    `json:"created_at"`
	UpdatedAt      time.Time    `json:"updated_at"`
}

func (l *Lead) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	return nil
}

type PredefinedService struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	Name      string    `gorm:"not null;uniqueIndex" json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

func (p *PredefinedService) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}

type Stats struct {
	TotalCampaigns   int64 `json:"total_campaigns"`
	RunningCampaigns int64 `json:"running_campaigns"`
	TotalLeads       int64 `json:"total_leads"`
	TotalWithEmail   int64 `json:"total_with_email"`
	TotalWithPhone   int64 `json:"total_with_phone"`
	TotalEnriched    int64 `json:"total_enriched"`
}

type Setting struct {
	Key         string `gorm:"primaryKey" json:"key"`
	Value       string `gorm:"type:text" json:"value"`
	Description string `gorm:"type:text" json:"description"`
}

type User struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	Email        string    `gorm:"uniqueIndex;not null" json:"email"`
	PasswordHash string    `gorm:"not null" json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	return nil
}
