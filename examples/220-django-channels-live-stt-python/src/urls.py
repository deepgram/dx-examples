from django.urls import path, re_path

from views import index
from consumer import TranscriptionConsumer

urlpatterns = [
    path("", index),
]

websocket_urlpatterns = [
    re_path(r"ws/transcribe/$", TranscriptionConsumer.as_asgi()),
]
