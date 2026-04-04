#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use deepgram::common::options::{Encoding, Model, Options};
use deepgram::common::stream_response::StreamResponse;
use deepgram::Deepgram;
use std::env;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};

struct AppState {
    // Channel for sending audio bytes to the Deepgram worker task.
    // None when no transcription session is active.
    audio_tx: Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>>,
}

// Runs the Deepgram WebSocket session: forwards audio from the mpsc channel
// to Deepgram and emits transcript events back to the Tauri frontend.
async fn run_session(
    app: AppHandle,
    api_key: String,
    mut audio_rx: mpsc::Receiver<Vec<u8>>,
) {
    let dg = match Deepgram::new(&api_key) {
        Ok(d) => d,
        Err(e) => {
            let _ = app.emit("dg-error", e.to_string());
            return;
        }
    };

    let options = Options::builder()
        .model(Model::Nova3)
        .smart_format(true)
        .punctuate(true)
        .tag(["deepgram-examples"]) // <- THIS tags usage for Deepgram console tracking
        .build();

    let mut handle = match dg
        .transcription()
        .stream_request_with_options(options)
        .encoding(Encoding::Linear16)
        .sample_rate(16000)
        .channels(1)
        .interim_results(true)
        .utterance_end_ms(1500)
        .keep_alive()
        .handle()
        .await
    {
        Ok(h) => h,
        Err(e) => {
            let _ = app.emit("dg-error", e.to_string());
            return;
        }
    };

    let _ = app.emit("dg-status", "connected");

    // Single loop that multiplexes audio sending and response receiving.
    // tokio::select! lets us await both the audio channel and the Deepgram
    // WebSocket concurrently without needing to split the handle.
    loop {
        tokio::select! {
            biased;

            audio = audio_rx.recv() => {
                match audio {
                    Some(data) => {
                        if let Err(e) = handle.send_data(data).await {
                            let _ = app.emit("dg-error", e.to_string());
                            break;
                        }
                    }
                    // Frontend closed the channel — finalize
                    None => {
                        let _ = handle.close_stream().await;
                        break;
                    }
                }
            }

            resp = handle.receive() => {
                match resp {
                    Some(Ok(StreamResponse::TranscriptResponse {
                        channel,
                        is_final,
                        speech_final,
                        ..
                    })) => {
                        // channel.alternatives[0].transcript holds the text
                        if let Some(alt) = channel.alternatives.first() {
                            if !alt.transcript.is_empty() {
                                let _ = app.emit(
                                    "transcript",
                                    serde_json::json!({
                                        "text": alt.transcript,
                                        "is_final": is_final,
                                        "speech_final": speech_final,
                                        "confidence": alt.confidence,
                                    }),
                                );
                            }
                        }
                    }
                    Some(Ok(StreamResponse::TerminalResponse { .. })) => {
                        let _ = app.emit("dg-status", "closed");
                        break;
                    }
                    Some(Ok(StreamResponse::UtteranceEndResponse { .. })) => {
                        let _ = app.emit("utterance-end", "");
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        let _ = app.emit("dg-error", e.to_string());
                        break;
                    }
                    None => {
                        let _ = app.emit("dg-status", "closed");
                        break;
                    }
                }
            }
        }
    }

    let _ = app.emit("dg-status", "disconnected");
}

#[tauri::command]
async fn start_transcription(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let api_key = env::var("DEEPGRAM_API_KEY")
        .map_err(|_| "DEEPGRAM_API_KEY not set".to_string())?;

    // Stop any existing session first
    {
        let mut tx_guard = state.audio_tx.lock().await;
        tx_guard.take();
    }

    // Buffered channel — frontend sends audio chunks here; the worker
    // forwards them to Deepgram's WebSocket.
    let (audio_tx, audio_rx) = mpsc::channel::<Vec<u8>>(512);

    {
        let mut tx_guard = state.audio_tx.lock().await;
        *tx_guard = Some(audio_tx);
    }

    tokio::spawn(run_session(app, api_key, audio_rx));

    Ok(())
}

#[tauri::command]
async fn send_audio(
    state: State<'_, AppState>,
    audio: Vec<u8>,
) -> Result<(), String> {
    let tx_guard = state.audio_tx.lock().await;
    if let Some(tx) = tx_guard.as_ref() {
        tx.send(audio).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn stop_transcription(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut tx_guard = state.audio_tx.lock().await;
    // Dropping the sender closes the channel, which signals the worker
    // to finalize and disconnect from Deepgram.
    tx_guard.take();
    Ok(())
}

fn main() {
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .manage(AppState {
            audio_tx: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            start_transcription,
            send_audio,
            stop_transcription,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
