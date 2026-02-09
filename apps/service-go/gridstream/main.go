package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	hub := NewHub()
	go hub.Run()

	go StartSimulation(hub)

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "GridStream Engine: WebSocket Hub Active")
	})

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(hub, w, r)
	})

	port := "8002"
	fmt.Printf("⚡ GridStream Service Online at :%s\n", port)

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal("ListenAndServe:", err)
	}
}
