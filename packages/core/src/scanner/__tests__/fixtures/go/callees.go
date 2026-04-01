package main

import (
	"fmt"
	"os"
	"strings"
)

func processInput(input string) string {
	trimmed := strings.TrimSpace(input)
	fmt.Println("Processing:", trimmed)
	return trimmed
}

func main() {
	result := processInput(os.Args[1])
	fmt.Println(result)
	os.Exit(0)
}

type Server struct {
	host string
}

func (s *Server) Start() error {
	fmt.Println("Starting server on", s.host)
	return nil
}

func (s *Server) handleRequest(data string) {
	processed := processInput(data)
	fmt.Println("Handled:", processed)
}
