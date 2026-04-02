package com.deepgram.example;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final TranscriptionWebSocketHandler transcriptionHandler;

    public WebSocketConfig(TranscriptionWebSocketHandler transcriptionHandler) {
        this.transcriptionHandler = transcriptionHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // Browser clients connect here to stream audio and receive transcripts
        registry.addHandler(transcriptionHandler, "/ws/transcribe").setAllowedOrigins("*");
    }
}
