const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    unique: true,
    required: true,
  },
  name: {
    type: String,
    required: [true, 'Device name is required'],
    trim: true,
  },
  location: {
    type: String,
    required: [true, 'Location is required'],
    trim: true,
  },
  ip: {
    type: String,
    required: [true, 'IP address is required'],
  },
  model: {
    type: String,
    default: 'VisionGrade Edge v1.0',
  },
  firmware: {
    type: String,
    default: '1.0.0',
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'maintenance', 'error'],
    default: 'offline',
  },
  lastHeartbeat: Date,
  lastSeen: Date,
  specs: {
    cpu: String,
    memory: String,
    storage: String,
    gpu: String,
    os: String,
  },
  cameras: [{
    cameraId: String,
    name: String,
    status: { type: String, enum: ['active', 'inactive', 'error'], default: 'inactive' },
    resolution: String,
    fps: Number,
  }],
  metrics: {
    cpu: { type: Number, default: 0 },
    memory: { type: Number, default: 0 },
    disk: { type: Number, default: 0 },
    temperature: { type: Number, default: 0 },
    uptime: { type: Number, default: 0 },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  registeredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });

deviceSchema.index({ status: 1 });
deviceSchema.index({ lastHeartbeat: -1 });

deviceSchema.methods.isOnline = function() {
  if (!this.lastHeartbeat) return false;
  const diff = Date.now() - this.lastHeartbeat.getTime();
  return diff < 60000;
};

module.exports = mongoose.model('Device', deviceSchema);