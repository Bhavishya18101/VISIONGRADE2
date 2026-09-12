const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    unique: true,
    required: true,
  },
  farmer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  cropType: {
    type: String,
    required: [true, 'Crop type is required'],
    enum: ['onion', 'potato', 'tomato', 'garlic', 'ginger'],
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [0.1, 'Quantity must be at least 0.1 quintals'],
    max: [500, 'Quantity cannot exceed 500 quintals'],
  },
  preferredDate: {
    type: Date,
    required: [true, 'Preferred date is required'],
  },
  timeSlot: {
    type: String,
    required: [true, 'Time slot is required'],
    enum: [
      '06:00-08:00', '08:00-10:00', '10:00-12:00',
      '12:00-14:00', '14:00-16:00', '16:00-18:00'
    ],
  },
  mandiLocation: {
    type: String,
    required: [true, 'Mandi location is required'],
    enum: ['azadpur', 'vashi', 'yeshwanthpur', 'koyambedu', 'chandigarh'],
  },
  mandiName: String,
  vehicleNumber: {
    type: String,
    uppercase: true,
    trim: true,
  },
  notes: String,
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'],
    default: 'pending',
  },
  confirmedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  cancellationReason: String,
  gradingSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GradingSession',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

bookingSchema.index({ farmer: 1, preferredDate: 1 });
bookingSchema.index({ mandiLocation: 1, preferredDate: 1, timeSlot: 1 });
bookingSchema.index({ status: 1 });

bookingSchema.pre('save', async function(next) {
  if (!this.bookingId) {
    const count = await this.constructor.countDocuments();
    this.bookingId = `VG${Date.now().toString(36).toUpperCase()}${(count + 1).toString(36).toUpperCase().padStart(4, '0')}`;
  }
  if (!this.mandiName) {
    const mandiNames = {
      azadpur: 'Azadpur Mandi, Delhi',
      vashi: 'Vashi APMC, Navi Mumbai',
      yeshwanthpur: 'Yeshwanthpur APMC, Bengaluru',
      koyambedu: 'Koyambedu Market, Chennai',
      chandigarh: 'Sector 26 Mandi, Chandigarh',
    };
    this.mandiName = mandiNames[this.mandiLocation] || this.mandiLocation;
  }
  next();
});

module.exports = mongoose.model('Booking', bookingSchema);