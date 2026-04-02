package com.deepgram.example;

import com.deepgram.DeepgramClient;
import com.deepgram.resources.listen.v1.types.ListenV1CloseStream;
import com.deepgram.resources.listen.v1.types.ListenV1CloseStreamType;
import com.deepgram.resources.listen.v1.websocket.V1ConnectOptions;
import com.deepgram.resources.listen.v1.websocket.V1WebSocketClient;
import com.deepgram.types.ListenV1Model;
import com.deepgram.types.ListenV1SmartFormat;
import com.deepgram.types.ListenV1InterimResults;
import com.deepgram.types.ListenV1Tag;
import okio.ByteString;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.BinaryWebSocketHandler;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Component
public class TranscriptionWebSocketHandler extends BinaryWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(TranscriptionWebSocketHandler.class);

    // One Deepgram WebSocket per browser session so each user gets independent transcription
    private final Map<String, V1WebSocketClient> deepgramClients = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String apiKey = System.getenv("DEEPGRAM_API_KEY");
        if (apiKey == null || apiKey.isBlank()) {
            session.sendMessage(new TextMessage("{\"error\":\"DEEPGRAM_API_KEY not set\"}"));
            session.close(CloseStatus.SERVER_ERROR);
            return;
        }

        DeepgramClient client = DeepgramClient.builder().apiKey(apiKey).build();
        V1WebSocketClient ws = client.listen().v1().v1WebSocket();

        ws.onResults(result -> {
            try {
                if (result.getChannel() != null
                        && result.getChannel().getAlternatives() != null
                        && !result.getChannel().getAlternatives().isEmpty()) {
                    String transcript = result.getChannel().getAlternatives().get(0).getTranscript();
                    boolean isFinal = result.getIsFinal().orElse(false);
                    if (transcript != null && !transcript.isEmpty()) {
                        // Send JSON to the browser: { "transcript": "...", "is_final": true/false }
                        String json = String.format(
                                "{\"transcript\":\"%s\",\"is_final\":%b}",
                                transcript.replace("\"", "\\\""), isFinal);
                        if (session.isOpen()) {
                            session.sendMessage(new TextMessage(json));
                        }
                    }
                }
            } catch (Exception e) {
                log.error("Failed to forward transcript to browser", e);
            }
        });

        ws.onError(error -> log.error("Deepgram error for session {}: {}", session.getId(), error.getMessage()));

        ws.onDisconnected(reason ->
                log.info("Deepgram disconnected for session {} (code={}, reason={})",
                        session.getId(), reason.getCode(), reason.getReason()));

        // Connect with Nova-3 + smart formatting; tag is REQUIRED for internal tracking
        ws.connect(V1ConnectOptions.builder()
                .model(ListenV1Model.NOVA3)
                .smartFormat(ListenV1SmartFormat.TRUE)
                .interimResults(ListenV1InterimResults.TRUE)
                .tag(ListenV1Tag.of("deepgram-examples"))       // ← REQUIRED: tags usage in Deepgram console
                .build()
        ).get(10, TimeUnit.SECONDS);

        deepgramClients.put(session.getId(), ws);
        log.info("Browser session {} connected — Deepgram WebSocket open", session.getId());
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
        V1WebSocketClient ws = deepgramClients.get(session.getId());
        if (ws != null) {
            // Forward raw audio from the browser straight to Deepgram
            ws.sendMedia(ByteString.of(message.getPayload()));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        V1WebSocketClient ws = deepgramClients.remove(session.getId());
        if (ws != null) {
            try {
                ws.sendCloseStream(ListenV1CloseStream.builder()
                        .type(ListenV1CloseStreamType.CLOSE_STREAM)
                        .build());
            } catch (Exception e) {
                log.debug("Error sending CloseStream", e);
            }
            ws.disconnect();
        }
        log.info("Browser session {} closed ({})", session.getId(), status);
    }
}
