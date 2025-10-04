# Windsurf Dataset Backend

## Overview
FastAPI backend providing low-latency API for windsurf video annotation and AI model integration.

## Architecture
- **FastAPI** - Web framework
- **Persistent models** - SAM2, DINO, GPT-5 loaded once
- **Redis** - Caching and session management
- **WebSocket** - Real-time updates
- **ClearML integration** - Heavy processing on 20×T4 cluster

## Key Features
- Scene detection with PySceneDetect
- AI model endpoints (DINO, GPT-5, SAM2)
- Project management and annotation storage
- Tracking job management with auto-splitting
- Export to multiple formats (COCO, Pascal VOC, YOLO)

## API Documentation
See `/docs/FastAPI_Routes_Planning.md` for complete route specifications.