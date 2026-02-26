package hub

import (
	"encoding/json"
	"leaf/internal/worker"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin:     func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
}

type Hub struct {
	clients   map[*client]bool
	mu        sync.RWMutex
	broadcast chan worker.BroadcastMsg
}

type client struct {
	conn *websocket.Conn
	send chan []byte
}

func New(broadcast chan worker.BroadcastMsg) *Hub {
	h := &Hub{
		clients:   make(map[*client]bool),
		broadcast: broadcast,
	}
	go h.run()
	return h
}

func (h *Hub) run() {
	for msg := range h.broadcast {
		data, err := json.Marshal(msg)
		if err != nil {
			continue
		}

		h.mu.RLock()
		for c := range h.clients {
			select {
			case c.send <- data:
			default:
				close(c.send)
				delete(h.clients, c)
			}
		}
		h.mu.RUnlock()
	}
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade error: %v", err)
		return
	}

	c := &client{conn: conn, send: make(chan []byte, 256)}

	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()

	go c.writePump()
	c.readPump(h)
}

func (c *client) writePump() {
	defer c.conn.Close()
	for msg := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

func (c *client) readPump(h *Hub) {
	defer func() {
		h.mu.Lock()
		delete(h.clients, c)
		h.mu.Unlock()
		close(c.send)
		c.conn.Close()
	}()

	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			break
		}
	}
}
