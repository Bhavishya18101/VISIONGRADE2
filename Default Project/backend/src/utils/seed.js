const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, Booking, Device, GradingSession } = require('../models');
const connectDB = require('../config/database');

const seedDatabase = async () => {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    await Promise.all([
      User.deleteMany({}),
      Booking.deleteMany({}),
      Device.deleteMany({}),
      GradingSession.deleteMany({}),
    ]);
    console.log('Cleared existing data');

    const adminPassword = await bcrypt.hash('admin123', 12);
    const farmerPassword = await bcrypt.hash('farmer123', 12);

    const admin = await User.create({
      name: 'Admin User',
      email: 'admin@visiongrade.com',
      password: adminPassword,
      role: 'admin',
      phone: '+91-9876543210',
      isActive: true,
    });

    const farmer = await User.create({
      name: 'Rajesh Kumar',
      email: 'farmer@visiongrade.com',
      password: farmerPassword,
      role: 'farmer',
      phone: '+91-9876543211',
      address: {
        village: 'Sonipat',
        district: 'Sonipat',
        state: 'Haryana',
        pincode: '131001',
      },
      farmDetails: {
        landSize: 5,
        crops: ['onion', 'potato'],
        certifications: ['Agmark', 'Organic'],
      },
      isActive: true,
    });

    const farmer2 = await User.create({
      name: 'Priya Sharma',
      email: 'priya@visiongrade.com',
      password: farmerPassword,
      role: 'farmer',
      phone: '+91-9876543212',
      address: {
        village: 'Nashik',
        district: 'Nashik',
        state: 'Maharashtra',
        pincode: '422001',
      },
      farmDetails: {
        landSize: 3,
        crops: ['onion'],
        certifications: ['Agmark'],
      },
      isActive: true,
    });

    console.log('Created users:', admin.email, farmer.email, farmer2.email);

    const devices = await Device.insertMany([
      {
        deviceId: 'VG-EDGE-001',
        name: 'Grading Station Alpha',
        location: 'Azadpur Mandi, Delhi',
        ip: '192.168.1.100',
        model: 'VisionGrade Edge v1.0',
        firmware: '1.2.0',
        status: 'online',
        lastHeartbeat: new Date(),
        specs: {
          cpu: 'NVIDIA Jetson Orin NX 16GB',
          memory: '16GB LPDDR5',
          storage: '256GB NVMe',
          gpu: '1024-core NVIDIA Ampere',
          os: 'Ubuntu 22.04 (JetPack 5.1)',
        },
        cameras: [
          { cameraId: 'cam0', name: 'Main Camera', status: 'active', resolution: '1280x720', fps: 30 },
          { cameraId: 'cam1', name: 'Secondary Camera', status: 'active', resolution: '1280x720', fps: 30 },
        ],
        metrics: { cpu: 45, memory: 60, disk: 35, temperature: 52, uptime: 86400 },
        registeredBy: admin._id,
      },
      {
        deviceId: 'VG-EDGE-002',
        name: 'Grading Station Beta',
        location: 'Vashi APMC, Navi Mumbai',
        ip: '192.168.1.101',
        model: 'VisionGrade Edge v1.0',
        firmware: '1.2.0',
        status: 'online',
        lastHeartbeat: new Date(),
        specs: {
          cpu: 'NVIDIA Jetson Orin NX 16GB',
          memory: '16GB LPDDR5',
          storage: '256GB NVMe',
          gpu: '1024-core NVIDIA Ampere',
          os: 'Ubuntu 22.04 (JetPack 5.1)',
        },
        cameras: [
          { cameraId: 'cam0', name: 'Main Camera', status: 'active', resolution: '1280x720', fps: 30 },
        ],
        metrics: { cpu: 38, memory: 55, disk: 28, temperature: 48, uptime: 172800 },
        registeredBy: admin._id,
      },
      {
        deviceId: 'VG-EDGE-003',
        name: 'Grading Station Gamma',
        location: 'Yeshwanthpur APMC, Bengaluru',
        ip: '192.168.1.102',
        model: 'VisionGrade Edge v1.0',
        firmware: '1.1.5',
        status: 'maintenance',
        lastHeartbeat: new Date(Date.now() - 3600000),
        specs: {
          cpu: 'NVIDIA Jetson Xavier NX',
          memory: '8GB LPDDR4',
          storage: '128GB NVMe',
          gpu: '384-core NVIDIA Volta',
          os: 'Ubuntu 20.04 (JetPack 4.6)',
        },
        cameras: [
          { cameraId: 'cam0', name: 'Main Camera', status: 'inactive', resolution: '1280x720', fps: 30 },
        ],
        metrics: { cpu: 0, memory: 0, disk: 45, temperature: 35, uptime: 0 },
        registeredBy: admin._id,
      },
    ]);

    console.log('Created devices:', devices.length);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const bookings = await Booking.insertMany([
      {
        farmer: farmer._id,
        cropType: 'onion',
        quantity: 15,
        preferredDate: new Date(today.getTime() + 86400000),
        timeSlot: '08:00-10:00',
        mandiLocation: 'azadpur',
        vehicleNumber: 'HR01AB1234',
        notes: 'Agmark certified Grade A onions',
        status: 'confirmed',
        confirmedAt: new Date(),
      },
      {
        farmer: farmer._id,
        cropType: 'onion',
        quantity: 10,
        preferredDate: new Date(today.getTime() + 2 * 86400000),
        timeSlot: '10:00-12:00',
        mandiLocation: 'azadpur',
        vehicleNumber: 'HR01AB1234',
        status: 'pending',
      },
      {
        farmer: farmer2._id,
        cropType: 'onion',
        quantity: 25,
        preferredDate: today,
        timeSlot: '06:00-08:00',
        mandiLocation: 'vashi',
        vehicleNumber: 'MH15CD5678',
        status: 'completed',
        confirmedAt: new Date(Date.now() - 86400000),
        completedAt: new Date(),
      },
      {
        farmer: farmer2._id,
        cropType: 'potato',
        quantity: 20,
        preferredDate: new Date(today.getTime() + 86400000),
        timeSlot: '14:00-16:00',
        mandiLocation: 'vashi',
        vehicleNumber: 'MH15CD5678',
        status: 'pending',
      },
    ]);

    console.log('Created bookings:', bookings.length);

    const session = await GradingSession.create({
      device: devices[0]._id,
      camera: 'cam0',
      operator: admin._id,
      booking: bookings[2]._id,
      status: 'completed',
      startTime: new Date(Date.now() - 7200000),
      endTime: new Date(Date.now() - 3600000),
      totalProcessed: 1250,
      stats: {
        gradeA: 680,
        gradeB: 420,
        gradeC: 100,
        rejected: 50,
        totalWeight: 2500000,
        avgConfidence: 0.92,
        avgInferenceTime: 28,
      },
    });

    console.log('Created grading session:', session.sessionId);

    console.log('\n✅ Database seeded successfully!');
    console.log('\nDemo Credentials:');
    console.log('Admin: admin@visiongrade.com / admin123');
    console.log('Farmer: farmer@visiongrade.com / farmer123');
    console.log('Farmer: priya@visiongrade.com / farmer123');

  } catch (error) {
    console.error('Seeding error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };