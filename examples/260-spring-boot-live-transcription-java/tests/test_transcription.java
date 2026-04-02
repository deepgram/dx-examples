import com.deepgram.DeepgramClient;
import com.deepgram.resources.listen.v1.types.ListenV1CloseStream;
import com.deepgram.resources.listen.v1.types.ListenV1CloseStreamType;
import com.deepgram.resources.listen.v1.websocket.V1ConnectOptions;
import com.deepgram.resources.listen.v1.websocket.V1WebSocketClient;
import com.deepgram.types.ListenV1Model;
import com.deepgram.types.ListenV1Tag;
import okio.ByteString;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public class test_transcription {

    public static void main(String[] args) throws Exception {
        // ── Credential check — MUST be first ──────────────────────────────────────
        Path envExample = Path.of(System.getProperty("user.dir"), ".env.example");
        if (!Files.exists(envExample)) {
            envExample = Path.of(System.getProperty("user.dir"), "..", ".env.example");
        }
        java.util.List<String> required = Files.readAllLines(envExample).stream()
                .filter(l -> !l.isBlank() && !l.startsWith("#") && l.contains("="))
                .map(l -> l.split("=")[0].trim())
                .toList();
        java.util.List<String> missing = required.stream()
                .filter(k -> System.getenv(k) == null || System.getenv(k).isBlank())
                .toList();
        if (!missing.isEmpty()) {
            System.err.println("MISSING_CREDENTIALS: " + String.join(",", missing));
            System.exit(2);
        }
        // ──────────────────────────────────────────────────────────────────────────

        byte[] audio = URI.create("https://dpgr.am/spacewalk.wav").toURL().openStream().readAllBytes();

        DeepgramClient client = DeepgramClient.builder()
                .apiKey(System.getenv("DEEPGRAM_API_KEY"))
                .build();

        V1WebSocketClient ws = client.listen().v1().v1WebSocket();

        AtomicBoolean gotTranscript = new AtomicBoolean(false);
        AtomicReference<String> lastTranscript = new AtomicReference<>("");
        CountDownLatch done = new CountDownLatch(1);

        ws.onResults(result -> {
            if (result.getIsFinal().orElse(false)
                    && result.getChannel() != null
                    && result.getChannel().getAlternatives() != null
                    && !result.getChannel().getAlternatives().isEmpty()) {
                String t = result.getChannel().getAlternatives().get(0).getTranscript();
                if (t != null && !t.isEmpty()) {
                    gotTranscript.set(true);
                    lastTranscript.set(t);
                }
            }
        });

        ws.onError(e -> {
            System.err.println("Deepgram error: " + e.getMessage());
        });

        ws.onDisconnected(r -> done.countDown());

        CompletableFuture<Void> connectFuture = ws.connect(V1ConnectOptions.builder()
                .model(ListenV1Model.NOVA3)
                .tag(ListenV1Tag.of("deepgram-examples"))
                .build());
        connectFuture.get(10, TimeUnit.SECONDS);

        for (int i = 0; i < audio.length; i += 4096) {
            ws.sendMedia(ByteString.of(audio, i, Math.min(4096, audio.length - i)));
        }

        ws.sendCloseStream(ListenV1CloseStream.builder()
                .type(ListenV1CloseStreamType.CLOSE_STREAM)
                .build());

        done.await(60, TimeUnit.SECONDS);
        ws.disconnect();

        if (!gotTranscript.get()) {
            System.err.println("FAIL: No transcript received");
            System.exit(1);
        }

        System.out.println("PASS: Received transcript — \"" + lastTranscript.get() + "\"");
        System.exit(0);
    }
}
