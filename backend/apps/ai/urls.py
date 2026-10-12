from django.urls import path

from . import views

urlpatterns = [
    path("ai/stream/", views.stream, name="ai-stream"),
    path("ai/tools/", views.tools, name="ai-tools"),
    path("ai/providers/", views.providers, name="ai-providers"),
    path("ai/models/", views.models, name="ai-models"),
    path("ai/options/", views.options, name="ai-options"),
    path("ai/generate/", views.generate, name="ai-generate"),
]
