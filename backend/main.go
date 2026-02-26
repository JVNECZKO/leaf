package main

import (
	"leaf/internal/api"
	"leaf/internal/db"
	"leaf/internal/enrichment"
	"leaf/internal/hub"
	"leaf/internal/scraper"
	"leaf/internal/worker"
	"log"
	"os"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	database := db.Connect()
	repo := db.NewRepository(database)

	scraperCfg := scraper.Config{
		ProxyURL: os.Getenv("PROXY_URL"),
		Headless: os.Getenv("HEADLESS") != "false",
	}
	scrpr := scraper.New(scraperCfg)
	defer scrpr.Close()

	enrichr := enrichment.New(os.Getenv("PROXY_URL"))

	broadcast := make(chan worker.BroadcastMsg, 512)

	mgr := worker.NewManager(repo, scrpr, enrichr, broadcast)

	wsHub := hub.New(broadcast)

	srv := api.New(repo, mgr, wsHub)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("leaf backend listening on :%s", port)
	if err := srv.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
