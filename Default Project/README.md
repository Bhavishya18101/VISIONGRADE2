# VisionGrade - Automated Agricultural Grading System

A full-stack hardware and software ecosystem for automated agricultural grading of onions in Mandis, leveraging Edge AI and real-time telemetry.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Farmer Portal │────▶│  Node.js Backend │◀───▶│  Admin Dashboard│
│  (Slot Booking) │     │  (API + WS)      │     │  (Telemetry)    │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌─────────────┐            ┌─────────────┐
            │  MongoDB    │            │ Python AI   │
            │  Database   │            │  Service    │
            └─────────────┘            └─────────────┘
                                              │
                                              ▼
                                      ┌─────────────┐
                                      │  Edge Camera│
                                      │  + YOLOv8   │
                                      └─────────────┘
```

## Tech Stack

### Frontend
- **Pure HTML5, CSS3, Vanilla JavaScript** (No frameworks)
- Dark-mode compatible with deep purple gradient palette (#18002f to #5a2e89)
- Responsive CSS Flexbox/Grid layout
- WebSocket client for real-time updates

### Backend
- **Node.js + Express.js** (JavaScript)
- **MongoDB** with Mongoose ODM
- **Socket.io** for WebSocket real-time communication
- **JWT** authentication with role-based access (Admin/Farmer)
- RESTful API design

### AI & Computer Vision
- **Python** with **Ultralytics YOLOv8**
- **OpenCV** for camera capture and image processing
- **PyTorch** backend for inference
- Edge deployment on NVIDIA Jetson / GPU-enabled devices

### Infrastructure
- **Docker & Docker Compose** for containerization
- **Nginx** reverse proxy for frontend
- Multi-service orchestration

## Project Structure

```
visiongrade/
├── frontend/                 # Static frontend assets
│   ├── css/
│   │   └── main.css         # Complete design system
│   ├── js/
│   │   ├── auth.js          # Authentication utilities
│   │   ├── login.js         # Login page logic
│   │   ├── farmer.js        # Farmer portal logic
│   │   └── admin.js         # Admin dashboard logic
│   ├── login.html           # Unified login portal
│   ├── farmer_landing.html  # Farmer slot booking
│   └── main.html            # Admin dashboard
│
├── backend/                  # Node.js/Express backend
│   ├── src/
│   │   ├── config/
│   │   │   └── database.js  # MongoDB connection
│   │   ├── middleware/
│   │   │   ├── auth.js      # JWT auth middleware
│   │   │   ├── validate.js  # Request validation
│   │   │   └── errorHandler.js
│   │   ├── models/
│   │   │   ├── User.js      # User schema (Admin/Farmer)
│   │   │   ├── Booking.js   # Slot booking schema
│   │   │   ├── Grading.js   # Grading session/result schemas
│   │   │   └── Device.js    # Edge device schema
│   │   ├── routes/
│   │   │   ├── auth.js      # Authentication routes
│   │   │   ├── bookings.js  # Booking CRUD
│   │   │   ├── grading.js   # Grading history/stats
│   │   │   ├── admin.js     # Admin analytics
│   │   │   ├── devices.js   # Device management
│   │   │   └── cameras.js   # Camera streaming
│   │   └── server.js        # Express + Socket.io server
│   ├── package.json
│   └── Dockerfile
│
├── python_ai/               # Python AI Service
│   ├── main.py              # Main edge inference service
│   ├── train.py             # YOLO model training script
│   ├── requirements.txt
│   ├── services/
│   │   ├── inference.py     # Core inference logic
│   │   └── camera_stream.py # MJPEG camera streaming
│   ├── utils/
│   │   └── helpers.py       # CV utilities
│   └── Dockerfile
│
├── docker-compose.yml       # Full stack orchestration
├── nginx.conf               # Nginx reverse proxy config
└── README.md
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- NVIDIA GPU (for AI service) or CPU fallback
- 4GB+ RAM recommended

### Development Setup

1. **Clone and configure**
```bash
git clone <repo>
cd visiongrade
cp .env.example .env
# Edit .env with your settings
```

2. **Start all services**
```bash
docker-compose up -d
```

3. **Access applications**
- Frontend: http://localhost
- Backend API: http://localhost:3000
- WebSocket: ws://localhost:3001
- Python AI: http://localhost:5000

### Manual Development

**Backend:**
```bash
cd backend
npm install
npm run dev
```

**Frontend:**
```bash
cd frontend
# Serve with any static server
npx serve .
# or
python -m http.server 8080
```

**Python AI:**
```bash
cd python_ai
pip install -r requirements.txt
python main.py
```

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@visiongrade.com | admin123 |
| Farmer | farmer@visiongrade.com | farmer123 |

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile
- `PUT /api/auth/update-password` - Change password

### Bookings (Farmer)
- `POST /api/bookings` - Create booking
- `GET /api/bookings/my` - List my bookings
- `GET /api/bookings/availability` - Check slot availability
- `DELETE /api/bookings/:id` - Cancel booking

### Bookings (Admin)
- `GET /api/bookings` - List all bookings (with filters)
- `PATCH /api/bookings/:id/status` - Update booking status

### Grading
- `GET /api/grading/history` - Farmer grading history
- `GET /api/grading/sessions` - Admin: all sessions
- `GET /api/grading/stats` - Admin: grading analytics

### Admin
- `GET /api/admin/stats` - Dashboard statistics
- `GET /api/admin/analytics` - Charts data
- `GET /api/admin/activity` - Recent activity feed
- `GET /api/admin/health` - System health check

### Devices (Admin)
- `GET /api/devices` - List devices
- `POST /api/devices` - Register device
- `GET /api/devices/:id` - Device details
- `POST /api/devices/:id/heartbeat` - Device heartbeat
- `POST /api/devices/:id/restart` - Restart device

### Cameras
- `GET /api/cameras` - List available cameras
- `GET /api/cameras/:id/stream` - Get stream URL

## WebSocket Events

### Client → Server
```javascript
// Subscribe to channels
ws.send(JSON.stringify({
  type: 'subscribe',
  channels: ['telemetry', 'grading', 'bookings', 'alerts']
}))

// Device heartbeat
ws.send(JSON.stringify({
  type: 'device_heartbeat',
  data: { deviceId, metrics, cameras }
}))

// Grading results (from edge device)
ws.send(JSON.stringify({
  type: 'grading_result',
  data: { sessionId, imageUrl, detection, inferenceTime }
}))
```

### Server → Client
```javascript
// Telemetry update
{ type: 'telemetry', data: { throughput, grades, mandi, devices, stats } }

// Grading result
{ type: 'grading_result', data: { detection, sessionStats, recentDetections } }

// Booking update
{ type: 'booking_update', data: { bookingId } }

// Alert
{ type: 'alert', data: { message, severity } }

// Device status
{ type: 'device_status', data: { deviceId, status, metrics } }
```

## Agmark Grading Standards

The system implements Agmark onion grading:

| Grade | Size Range | Color | Price (₹/qt) |
|-------|------------|-------|--------------|
| Grade A | 50-70mm | Green | 2,500 |
| Grade B | 40-50mm | Yellow | 1,800 |
| Grade C | 30-40mm | Orange | 1,200 |
| Rejected | <30mm | Red | 0 |

## Edge AI Pipeline

1. **Camera Capture** - OpenCV captures frames at 30fps
2. **Preprocessing** - Letterbox resize to 640x640
3. **Inference** - YOLOv8 detects onions
4. **Classification** - Size-based Agmark grading
5. **Quality Metrics** - Color, shape, surface, size scores
6. **Stream Results** - WebSocket to backend + MJPEG overlay

## Model Training

```bash
cd python_ai
# Prepare data in data/train, data/val directories
# Format: YOLO format (images + labels)
python train.py
```

Best model saved to `runs/train/onion_grading/weights/best.pt`

Copy to `models/best.pt` for production use.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | mongodb://localhost:27017/visiongrade |
| `JWT_SECRET` | JWT signing secret | (required) |
| `JWT_EXPIRES_IN` | Token expiry | 7d |
| `PYTHON_AI_URL` | Python service URL | http://localhost:5000 |
| `WS_PORT` | WebSocket port | 3001 |
| `DEVICE_ID` | Edge device identifier | VG-EDGE-001 |
| `MODEL_PATH` | YOLO model path | models/best.pt |
| `CONFIDENCE_THRESHOLD` | Detection confidence | 0.5 |

## Deployment

### Production Checklist
- [ ] Change `JWT_SECRET` to strong random string
- [ ] Use MongoDB Atlas or secured MongoDB instance
- [ ] Configure HTTPS with SSL certificates
- [ ] Set `NODE_ENV=production`
- [ ] Configure proper CORS origins
- [ ] Set up monitoring (Prometheus/Grafana)
- [ ] Configure log aggregation
- [ ] Set up backup strategy for MongoDB

### Kubernetes (Helm)
```yaml
# TODO: Add Helm charts for K8s deployment
```

## Monitoring & Health

- **Backend Health**: `GET /api/health`
- **Python AI Health**: `GET http://python-ai:5000/health`
- **Database**: MongoDB connection status via admin panel
- **Devices**: Real-time heartbeat monitoring
- **WebSocket**: Connection status in dashboard header

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

MIT License - see LICENSE file for details.

## Support

For issues and feature requests, please open a GitHub issue.

---

**VisionGrade** - Empowering Mandis with AI-driven agricultural grading