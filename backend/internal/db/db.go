package db

import (
	"leaf/internal/models"
	"log"
	"os"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Connect() *gorm.DB {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://leaf:leafpassword@localhost:5432/leafdb?sslmode=disable"
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}

	if err := db.AutoMigrate(
		&models.Campaign{},
		&models.Service{},
		&models.Location{},
		&models.Task{},
		&models.Lead{},
		&models.Setting{},
		&models.User{},
		&models.PredefinedService{},
	); err != nil {
		log.Fatalf("failed to migrate database: %v", err)
	}

	seedDefaultSettings(db)
	seedAdminUser(db)

	log.Println("database connected and migrated")
	return db
}

func seedAdminUser(db *gorm.DB) {
	email := os.Getenv("ADMIN_EMAIL")
	password := os.Getenv("ADMIN_PASSWORD")
	if email == "" || password == "" {
		log.Println("[auth] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin seed")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("[auth] failed to hash admin password: %v", err)
	}

	var user models.User
	if err := db.Where("email = ?", email).First(&user).Error; err != nil {
		// User doesn't exist — create
		user = models.User{Email: email, PasswordHash: string(hash)}
		if err := db.Create(&user).Error; err != nil {
			log.Printf("[auth] failed to seed admin user: %v", err)
		} else {
			log.Printf("[auth] admin user created: %s", email)
		}
	} else {
		// User exists — update password hash so .env changes take effect on restart
		if err := db.Model(&user).Update("password_hash", string(hash)).Error; err != nil {
			log.Printf("[auth] failed to update admin password: %v", err)
		} else {
			log.Printf("[auth] admin password updated: %s", email)
		}
	}
}

func seedDefaultSettings(db *gorm.DB) {
	defaults := []models.Setting{
		{Key: "MAX_BROWSERS", Value: envOrDefault("MAX_BROWSERS", "3"), Description: "Max parallel Chrome instances (requires restart)"},
		{Key: "ENRICHMENT_WORKERS", Value: envOrDefault("ENRICHMENT_WORKERS", "10"), Description: "Concurrent website enrichment workers"},
		{Key: "PROXY_URL", Value: os.Getenv("PROXY_URL"), Description: "HTTP proxy URL, e.g. http://user:pass@host:port (requires restart)"},
		{Key: "HEADLESS", Value: envOrDefault("HEADLESS", "true"), Description: "Run Chrome in headless mode (requires restart)"},
	}
	for i := range defaults {
		db.Where(models.Setting{Key: defaults[i].Key}).FirstOrCreate(&defaults[i])
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
