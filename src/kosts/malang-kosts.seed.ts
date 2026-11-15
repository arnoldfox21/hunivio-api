import { Kost } from './entities/kost.entity';

interface MalangArea {
  district: string;
  streets: string[];
  landmark: string;
  lat: number;
  lng: number;
}

const MALANG_AREAS: MalangArea[] = [
  {
    district: 'Lowokwaru - Ketawanggede',
    streets: ['Jl. Watugong', 'Jl. Kerto Pamuji', 'Jl. Kerto Sentono', 'Jl. Gajayana'],
    landmark: 'Dekat Gerbang UB',
    lat: -7.9518,
    lng: 112.6122,
  },
  {
    district: 'Lowokwaru - Sumbersari',
    streets: ['Jl. Bendungan Sutami', 'Jl. Sumbersari', 'Jl. Sigura-gura', 'Jl. Bendungan Sigura-gura'],
    landmark: 'Dekat Kampus UM & UB',
    lat: -7.9585,
    lng: 112.6114,
  },
  {
    district: 'Lowokwaru - Dinoyo',
    streets: ['Jl. MT. Haryono', 'Jl. Joyo Raharjo', 'Jl. Dinoyo Permai', 'Jl. Mertojoyo'],
    landmark: 'Dekat UIN Maulana Malik Ibrahim',
    lat: -7.9436,
    lng: 112.6067,
  },
  {
    district: 'Lowokwaru - Soekarno Hatta',
    streets: ['Jl. Soekarno Hatta', 'Jl. Bunga Coklat', 'Jl. Remujung', 'Jl. Candi Panggung'],
    landmark: 'Dekat Polinema & Taman Krida',
    lat: -7.9412,
    lng: 112.6209,
  },
  {
    district: 'Lowokwaru - Tlogomas',
    streets: ['Jl. Raya Tlogomas', 'Jl. Baiduri Bulan', 'Jl. Raya Tirto Utomo', 'Jl. Koral'],
    landmark: 'Dekat Kampus III UMM',
    lat: -7.9265,
    lng: 112.5968,
  },
  {
    district: 'Lowokwaru - Jatimulyo',
    streets: ['Jl. Pisang Kipas', 'Jl. Ikan Tombro', 'Jl. Sudimoro', 'Jl. Simpang Remujung'],
    landmark: 'Dekat Kawasan Suhat',
    lat: -7.9372,
    lng: 112.6265,
  },
  {
    district: 'Klojen - Ijen',
    streets: ['Jl. Besar Ijen', 'Jl. Retawu', 'Jl. Wilis', 'Jl. Pahlawan Trip'],
    landmark: 'Dekat Ijen Boulevard & MOG',
    lat: -7.9698,
    lng: 112.6238,
  },
  {
    district: 'Klojen - Oro-oro Dowo',
    streets: ['Jl. Brigjend Slamet Riadi', 'Jl. Buring', 'Jl. Muria', 'Jl. Semeru'],
    landmark: 'Dekat Alun-Alun Tugu & Stasiun Malang',
    lat: -7.9692,
    lng: 112.6312,
  },
  {
    district: 'Klojen - Penanggungan',
    streets: ['Jl. Surabaya', 'Jl. Jakarta', 'Jl. Bandung', 'Jl. Veteran'],
    landmark: 'Dekat Universitas Negeri Malang (UM)',
    lat: -7.9612,
    lng: 112.6201,
  },
  {
    district: 'Blimbing - Sulfat',
    streets: ['Jl. Sulfat Agung', 'Jl. Taman Sulfat', 'Jl. Karya Timur', 'Jl. Tumenggung Suryo'],
    landmark: 'Dekat RSIA Puri Bunda & Sulfat',
    lat: -7.9608,
    lng: 112.6512,
  },
  {
    district: 'Blimbing - Purwantoro',
    streets: ['Jl. Letjen S. Parman', 'Jl. Sunandar Priyo Sudarmo', 'Jl. Ciliwung', 'Jl. Kalimosodo'],
    landmark: 'Dekat Hotel Savana & Blimbing',
    lat: -7.9515,
    lng: 112.6398,
  },
  {
    district: 'Sukun - Dieng',
    streets: ['Jl. Raya Dieng', 'Jl. Terusan Dieng', 'Jl. Galunggung', 'Jl. Puncak Dieng'],
    landmark: 'Dekat Kampus UNMER Malang',
    lat: -7.9712,
    lng: 112.6085,
  },
  {
    district: 'Sukun - Karangbesuki',
    streets: ['Jl. Raya Candi II', 'Jl. Candi Mendut', 'Jl. Villa Puncak Tidar', 'Jl. Karangbesuki'],
    landmark: 'Dekat Kampus STIKI & Ma Chung',
    lat: -7.9602,
    lng: 112.5964,
  },
  {
    district: 'Kedungkandang - Sawojajar',
    streets: ['Jl. Danau Ranau', 'Jl. Danau Kerinci', 'Jl. Danau Toba', 'Jl. Raya Sawojajar'],
    landmark: 'Dekat Velodrome & Tol Madyopuro',
    lat: -7.9765,
    lng: 112.6584,
  },
];

const KOST_PREFIXES = [
  'Kost Griya',
  'Kost Omah',
  'Kost Paviliun',
  'Kost Taman',
  'Kost Puri',
  'Kost D\'Bale',
  'Kost Villa',
  'Kost Ndalem',
  'Kost Harmoni',
  'Kost Sentosa',
];

const KOST_SUFFIXES = [
  'Asri',
  'Mandiri',
  'Sejahtera',
  'Kencana',
  'Mawar',
  'Melati',
  'Anggrek',
  'Cendana',
  'Lestari',
  'Eksklusif',
];

const IMAGE_POOL = [
  'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=900&q=80',
  'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?w=900&q=80',
  'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=900&q=80',
  'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=900&q=80',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&q=80',
  'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=900&q=80',
  'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=900&q=80',
  'https://images.unsplash.com/photo-1540518614846-7ede433c4573?w=900&q=80',
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=900&q=80',
  'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=900&q=80',
  'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=900&q=80',
  'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=900&q=80',
];

const OWNER_NAMES = [
  'Ibu Ratna Kusuma',
  'Bapak Hendra Wijaya',
  'Ibu Siti Aminah',
  'Bapak Agus Santoso',
  'Ibu Dewi Lestari',
  'Bapak Bambang Pratama',
  'Ibu Endang Rahayu',
  'Bapak Rudi Hartono',
  'Ibu Yuliana Putri',
  'Bapak Eko Prasetyo',
];

export function buildMalangDummyKosts(count = 100): Partial<Kost>[] {
  const types = ['Putri', 'Putra', 'Campur'];
  const roomSizes = ['3 x 3 m', '3 x 4 m', '3.5 x 4 m', '4 x 4 m', '4 x 5 m'];
  const list: Partial<Kost>[] = [];

  for (let i = 1; i <= count; i++) {
    const area = MALANG_AREAS[(i - 1) % MALANG_AREAS.length];
    const street = area.streets[(i - 1) % area.streets.length];
    const prefix = KOST_PREFIXES[(i - 1) % KOST_PREFIXES.length];
    const suffix = KOST_SUFFIXES[Math.floor((i - 1) / 10) % KOST_SUFFIXES.length];
    const type = types[(i - 1) % types.length];
    const areaShort = area.district.split(' - ').pop() || area.district;
    const isExclusive = i % 4 === 0;
    const isBudget = i % 3 === 0 && !isExclusive;

    const name = `${prefix} ${suffix} ${areaShort} #${i}`;
    const slug = `kost-malang-${areaShort.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i}`;

    // Deterministic jitter around the area center (~200m - 700m spread)
    const angle = (i * 137.5) * (Math.PI / 180);
    const radius = 0.0018 + ((i % 7) * 0.00075);
    const latitude = Number((area.lat + Math.cos(angle) * radius).toFixed(6));
    const longitude = Number((area.lng + Math.sin(angle) * radius).toFixed(6));

    const basePrice = isExclusive
      ? 1500000 + ((i % 6) * 200000)
      : isBudget
        ? 600000 + ((i % 5) * 100000)
        : 950000 + ((i % 6) * 125000);

    const hasDiscount = i % 3 === 0;
    const discountPercent = hasDiscount ? 10 + (i % 3) * 5 : 0;
    const originalPrice = hasDiscount
      ? Math.round((basePrice * 100) / (100 - discountPercent) / 10000) * 10000
      : basePrice;

    const rating = 0;
    const reviewCount = 0;
    const availableRooms = 1 + (i % 6);

    const roomFacilities = isExclusive
      ? ['AC', 'WiFi', 'K. Mandi Dalam', 'Water Heater', 'Kasur', 'Lemari', 'Meja Belajar']
      : isBudget
        ? ['WiFi', 'Kasur', 'Lemari', 'Meja Belajar', 'Kipas Angin']
        : ['AC', 'WiFi', 'K. Mandi Dalam', 'Kasur', 'Lemari'];

    const publicFacilities = isExclusive
      ? ['Parkir Motor', 'Parkir Mobil', 'Dapur Bersama', 'CCTV', 'Kulkas', 'Akses 24 Jam']
      : ['Parkir Motor', 'Dapur Bersama', 'CCTV', 'Akses 24 Jam'];

    const rules = [
      'Akses 24 jam dengan kunci masing-masing',
      type === 'Putri'
        ? 'Tamu pria dilarang masuk kamar'
        : type === 'Putra'
          ? 'Tamu wanita dilarang masuk kamar'
          : 'Tamu wajib lapor pengelola kost',
      'Dilarang membawa hewan peliharaan',
      'Menjaga kebersihan dan ketenangan bersama',
    ];

    const img1 = IMAGE_POOL[(i - 1) % IMAGE_POOL.length];
    const img2 = IMAGE_POOL[(i + 2) % IMAGE_POOL.length];
    const img3 = IMAGE_POOL[(i + 5) % IMAGE_POOL.length];

    const houseNumber = 10 + ((i * 3) % 89);

    list.push({
      name,
      slug,
      propertyCategory: 'KOST',
      type,
      city: 'Malang',
      district: area.district,
      address: `${street} No. ${houseNumber}, ${area.district}, Kota Malang`,
      description: `${name} berlokasi strategis di kawasan ${area.district}, Kota Malang (${area.landmark}). Lingkungan tenang, aman dengan CCTV 24 jam, cocok untuk mahasiswa maupun pekerja di area Malang Raya.`,
      pricePerMonth: basePrice,
      originalPrice,
      discountPercent,
      rating,
      reviewCount,
      availableRooms,
      roomSize: roomSizes[(i - 1) % roomSizes.length],
      electricityIncluded: i % 2 === 0,
      isSinggahsini: i % 2 === 1 || isExclusive,
      isInstantBooking: true,
      roomFacilities,
      publicFacilities,
      rules,
      images: [img1, img2, img3],
      ownerName: OWNER_NAMES[(i - 1) % OWNER_NAMES.length],
      ownerPhone: `62812345${String(10000 + i).slice(-5)}`,
      ownerId: 1,
      nearbyLandmark: area.landmark,
      latitude,
      longitude,
      isFavorite: false,
    });
  }

  return list;
}

export function buildMalangApartmentsAndKontrakans(): Partial<Kost>[] {
  const results: Partial<Kost>[] = [];

  const aptLocations = [
    {
      name: 'Apartemen Begawan Malang',
      district: 'Lowokwaru - Tlogomas',
      address: 'Jl. Raya Tlogomas No. 1, Lowokwaru, Kota Malang',
      landmark: 'Dekat Kampus III UMM & Dinoyo',
      lat: -7.9261,
      lng: 112.5982,
    },
    {
      name: 'Apartemen Soekarno Hatta Residence',
      district: 'Lowokwaru - Soekarno Hatta',
      address: 'Jl. Soekarno Hatta No. 9, Lowokwaru, Kota Malang',
      landmark: 'Dekat UB & Polinema',
      lat: -7.9435,
      lng: 112.6175,
    },
    {
      name: 'Apartemen Nayumi Sam Tower',
      district: 'Lowokwaru - Sumbersari',
      address: 'Jl. MT. Haryono No. 168, Dinoyo, Kota Malang',
      landmark: 'Dekat UB, UIN & Matos',
      lat: -7.9478,
      lng: 112.6119,
    },
    {
      name: 'Apartemen Dieng Sky Suites',
      district: 'Sukun - Dieng',
      address: 'Jl. Raya Dieng No. 28, Sukun, Kota Malang',
      landmark: 'Dekat UNMER & Cyber Mall',
      lat: -7.9718,
      lng: 112.6095,
    },
    {
      name: 'Apartemen Ijen Suites Living',
      district: 'Klojen - Ijen',
      address: 'Jl. Ijen Nirwana Raya No. 12, Klojen, Kota Malang',
      landmark: 'Dekat Ijen Boulevard & MOG',
      lat: -7.9739,
      lng: 112.6194,
    },
  ];

  const unitTypes = ['Studio', '1BR', '2BR'];
  const furnishings = ['Furnished', 'Semi-Furnished', 'Furnished'];

  for (let i = 1; i <= 15; i++) {
    const loc = aptLocations[(i - 1) % aptLocations.length];
    const unitType = unitTypes[(i - 1) % unitTypes.length];
    const furnishing = furnishings[(i - 1) % furnishings.length];
    const floorLevel = 3 + ((i * 2) % 16);
    const bedrooms = unitType === 'Studio' ? 1 : unitType === '1BR' ? 1 : 2;
    const bathrooms = unitType === '2BR' ? 2 : 1;
    const buildingArea = unitType === 'Studio' ? 24 : unitType === '1BR' ? 36 : 54;
    const pricePerMonth =
      unitType === 'Studio'
        ? 2400000 + (i % 3) * 250000
        : unitType === '1BR'
          ? 3200000 + (i % 3) * 300000
          : 4500000 + (i % 3) * 400000;

    const angle = i * 72 * (Math.PI / 180);
    const lat = Number((loc.lat + Math.cos(angle) * 0.0012).toFixed(6));
    const lng = Number((loc.lng + Math.sin(angle) * 0.0012).toFixed(6));

    results.push({
      name: `${loc.name} Unit ${unitType} #${i}`,
      slug: `apartemen-malang-${i}-${unitType.toLowerCase()}`,
      propertyCategory: 'APARTEMEN',
      type: 'Campur',
      city: 'Malang',
      district: loc.district,
      address: loc.address,
      description: `Unit apartemen tipe ${unitType} (${furnishing}) di lantai ${floorLevel} ${loc.name}. Dilengkapi akses kartu lift, kolam renang, gym, dan keamanan 24 jam.`,
      pricePerMonth,
      pricePerDay: Math.round(pricePerMonth / 12 / 10000) * 10000,
      pricePerYear: pricePerMonth * 11,
      depositAmount: 1500000,
      originalPrice: pricePerMonth + 400000,
      discountPercent: 10,
      rating: 0,
      reviewCount: 0,
      availableRooms: 1 + (i % 3),
      roomSize: `${buildingArea} m²`,
      unitType,
      furnishing,
      floorLevel,
      buildingArea,
      bedrooms,
      bathrooms,
      hasCarport: true,
      isVerified: true,
      electricityIncluded: false,
      isSinggahsini: true,
      isInstantBooking: true,
      roomFacilities: ['AC', 'WiFi', 'Water Heater', 'TV', 'Kulkas', 'Kitchen Set'],
      publicFacilities: ['Kolam Renang', 'Gym', 'Parkir Mobil', 'CCTV', 'Security 24 Jam'],
      rules: ['Wajib registrasi penghuni di resepsionis', 'Dilarang membawa hewan peliharaan'],
      images: [
        IMAGE_POOL[(i + 1) % IMAGE_POOL.length],
        IMAGE_POOL[(i + 4) % IMAGE_POOL.length],
        IMAGE_POOL[(i + 7) % IMAGE_POOL.length],
      ],
      ownerName: OWNER_NAMES[(i - 1) % OWNER_NAMES.length],
      ownerPhone: `62812346${String(20000 + i).slice(-5)}`,
      ownerId: 1,
      nearbyLandmark: loc.landmark,
      latitude: lat,
      longitude: lng,
      isFavorite: false,
    });
  }

  const kontrakanAreas = [
    {
      district: 'Kedungkandang - Sawojajar',
      street: 'Jl. Danau Toba Blok C',
      landmark: 'Dekat Velodrome & Tol Madyopuro',
      lat: -7.9772,
      lng: 112.6604,
    },
    {
      district: 'Blimbing - Sulfat',
      street: 'Jl. Taman Sulfat Indah',
      landmark: 'Dekat RSIA Puri Bunda & Bandara',
      lat: -7.9619,
      lng: 112.6531,
    },
    {
      district: 'Lowokwaru - Tlogomas',
      street: 'Perum Bukit Cemara Tujuh',
      landmark: 'Dekat Kampus III UMM',
      lat: -7.9238,
      lng: 112.5934,
    },
    {
      district: 'Sukun - Bandulan',
      street: 'Perum Puncak Permata Sengkaling',
      landmark: 'Dekat UNMER & Dieng',
      lat: -7.9742,
      lng: 112.5991,
    },
    {
      district: 'Lowokwaru - Tunggulwulung',
      street: 'Perum Permata Jingga',
      landmark: 'Dekat Kawasan Soekarno Hatta',
      lat: -7.9295,
      lng: 112.6152,
    },
  ];

  for (let i = 1; i <= 15; i++) {
    const area = kontrakanAreas[(i - 1) % kontrakanAreas.length];
    const bedrooms = 2 + (i % 3); // 2, 3, or 4 KT
    const bathrooms = 1 + (i % 2);
    const buildingArea = 65 + (bedrooms * 15);
    const landArea = buildingArea + 25;
    const pricePerMonth = 1650000 + (bedrooms - 2) * 550000 + (i % 3) * 150000;
    const pricePerYear = pricePerMonth * 11;

    const angle = i * 95 * (Math.PI / 180);
    const lat = Number((area.lat + Math.cos(angle) * 0.0022).toFixed(6));
    const lng = Number((area.lng + Math.sin(angle) * 0.0022).toFixed(6));

    results.push({
      name: `Rumah Kontrakan ${area.district.split(' - ').pop()} ${bedrooms}KT #${i}`,
      slug: `kontrakan-malang-${i}-${bedrooms}kt`,
      propertyCategory: 'KONTRAKAN',
      type: 'Campur',
      city: 'Malang',
      district: area.district,
      address: `${area.street} No. ${12 + i}, ${area.district}, Kota Malang`,
      description: `Rumah kontrakan nyaman ${bedrooms} kamar tidur & ${bathrooms} kamar mandi di ${area.district}, Kota Malang. Cocok untuk keluarga muda maupun rombongan mahasiswa. Lingkungan asri, jalan lebar bisa simpangan mobil.`,
      pricePerMonth,
      pricePerYear,
      depositAmount: 1000000,
      originalPrice: pricePerMonth + 250000,
      discountPercent: 8,
      rating: 0,
      reviewCount: 0,
      availableRooms: 1,
      roomSize: `LB ${buildingArea}m² / LT ${landArea}m²`,
      unitType: `Rumah ${bedrooms} KT`,
      furnishing: i % 2 === 0 ? 'Semi-Furnished' : 'Unfurnished',
      floorLevel: i % 3 === 0 ? 2 : 1,
      buildingArea,
      landArea,
      bedrooms,
      bathrooms,
      hasCarport: true,
      isVerified: true,
      electricityIncluded: false,
      isSinggahsini: i % 2 === 0,
      isInstantBooking: true,
      roomFacilities: ['WiFi Ready', 'Dapur', 'Ruang Tamu', 'Meteran PLN Mandiri'],
      publicFacilities: ['Carport Mobil', 'Keamanan Cluster 24 Jam', 'Akses Jalan Lebar'],
      rules: ['Minimal sewa 3 bulan / 1 tahun', 'Menjaga kebersihan & ketertiban lingkungan'],
      images: [
        IMAGE_POOL[(i + 2) % IMAGE_POOL.length],
        IMAGE_POOL[(i + 5) % IMAGE_POOL.length],
        IMAGE_POOL[(i + 8) % IMAGE_POOL.length],
      ],
      ownerName: OWNER_NAMES[(i + 2) % OWNER_NAMES.length],
      ownerPhone: `62812347${String(30000 + i).slice(-5)}`,
      ownerId: 1,
      nearbyLandmark: area.landmark,
      latitude: lat,
      longitude: lng,
      isFavorite: false,
    });
  }

  return results;
}

export function buildMalangDailyStays(count = 50): Partial<Kost>[] {
  const results: Partial<Kost>[] = [];
  const villaNames = [
    'Villa Puncak Dieng',
    'Villa Ijen Heritage',
    'Villa Tidar Asri',
    'Villa Sawojajar Harmoni',
    'Villa Dinoyo Regency',
    'Villa Suhat Garden',
    'Villa Buring Indah',
    'Villa Tlogomas Retreat',
    'Villa Sulfat Residence',
    'Villa Ketawanggede Royal',
    'Villa Sumbersari Exclusive',
    'Villa Oro-oro Dowo',
    'Villa Merjosari Sanctuary',
    'Villa Karangbesuki Hill',
    'Villa Blimbing Serenity',
    'Villa Wilis Private',
    'Villa Candi Panggung',
    'Villa Semeru Pavilion',
    'Villa Gajayana Terrace',
    'Villa Purwantoro Estate',
    'Villa Kencana Malang',
    'Villa Anggrek Malang',
    'Villa Taman Sulfat',
    'Villa Panderman View',
    'Villa Nusantara Malang',
  ];
  const homestayNames = [
    'Homestay Omah Ijen',
    'Homestay Griya Suhat',
    'Homestay Ndalem Klojen',
    'Homestay Taman Dinoyo',
    'Homestay Bale Malang',
    'Homestay Kayutangan',
    'Homestay Sumbersari Cozy',
    'Homestay Tlogomas Indah',
    'Homestay Sawojajar Family',
    'Homestay Dieng Terrace',
    'Homestay Sulfat Nyaman',
    'Homestay Veteran Guest',
    'Homestay Buring Residence',
    'Homestay Purwantoro Asri',
    'Homestay Jatimulyo Home',
    'Homestay Sigura-gura',
    'Homestay Ketawanggede',
    'Homestay Penanggungan',
    'Homestay Ciliwung',
    'Homestay Semeru Guest',
    'Homestay Karangbesuki',
    'Homestay Candi Mendut',
    'Homestay Bandulan',
    'Homestay Madyopuro',
    'Homestay Rampal Malang',
  ];

  const villaImages = [
    'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=900&q=80',
    'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=900&q=80',
    'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=900&q=80',
    'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=900&q=80',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=900&q=80',
  ];

  for (let i = 1; i <= count; i++) {
    const isVilla = i % 2 === 1;
    const area = MALANG_AREAS[(i - 1) % MALANG_AREAS.length];
    const street = area.streets[(i - 1) % area.streets.length];
    const unitType = isVilla ? 'Villa' : 'Homestay';
    const nameIndex = Math.floor((i - 1) / 2);
    const baseName = isVilla
      ? villaNames[nameIndex % villaNames.length]
      : homestayNames[nameIndex % homestayNames.length];
    const name = nameIndex >= 25 ? `${baseName} ${i}` : baseName;

    const bedrooms = isVilla ? 3 + (i % 3) : 1 + (i % 3); // Villa 3-5 KT, Homestay 1-3 KT
    const bathrooms = isVilla ? 2 + (i % 2) : 1 + (i % 2);
    const buildingArea = isVilla ? 140 + bedrooms * 25 : 45 + bedrooms * 18;
    const landArea = isVilla ? buildingArea + 80 : buildingArea + 20;
    const pricePerDay = isVilla
      ? 750000 + (bedrooms - 3) * 300000 + (i % 4) * 100000
      : 220000 + (bedrooms - 1) * 90000 + (i % 4) * 35000;
    const originalPrice = pricePerDay + (isVilla ? 150000 : 50000);
    const discountPercent = isVilla ? 10 + (i % 3) * 3 : 8 + (i % 3) * 2;

    const angle = (i * 137.5) * (Math.PI / 180);
    const radius = 0.002 + ((i % 5) * 0.0012);
    const lat = Number((area.lat + Math.cos(angle) * radius).toFixed(6));
    const lng = Number((area.lng + Math.sin(angle) * radius).toFixed(6));

    results.push({
      name,
      slug: `hunian-harian-${unitType.toLowerCase()}-malang-${i}`,
      propertyCategory: 'HUNIAN_HARIAN',
      type: 'Campur',
      city: 'Malang',
      district: area.district,
      address: `${street} No. ${10 + i}, ${area.district}, Kota Malang`,
      description: isVilla
        ? `${name} menghadirkan suasana menginap privat di ${area.district}, Kota Malang. Dilengkapi ${bedrooms} kamar tidur, ${bathrooms} kamar mandi, ruang keluarga luas, dapur lengkap, serta area parkir pribadi. Cocok untuk liburan keluarga maupun staycation rombongan.`
        : `${name} menawarkan penginapan harian yang bersih, nyaman, dan strategis di ${area.district}, Kota Malang (${area.landmark}). Tersedia ${bedrooms} kamar tidur ber-AC, WiFi cepat, dan akses mudah ke pusat kuliner maupun kampus.`,
      pricePerMonth: 0,
      pricePerDay,
      depositAmount: 0,
      originalPrice,
      discountPercent,
      rating: 0,
      reviewCount: 0,
      availableRooms: isVilla ? 1 : 2 + (i % 3),
      roomSize: `LB ${buildingArea}m² / LT ${landArea}m²`,
      unitType,
      furnishing: 'Full-Furnished',
      floorLevel: isVilla ? (i % 2 === 0 ? 2 : 1) : 1,
      buildingArea,
      landArea,
      bedrooms,
      bathrooms,
      hasCarport: true,
      isVerified: true,
      electricityIncluded: true,
      isSinggahsini: i % 4 === 0,
      isInstantBooking: true,
      roomFacilities: isVilla
        ? ['AC', 'WiFi Cepat', 'Smart TV', 'Water Heater', 'Dapur Lengkap', 'Kulkas']
        : ['AC', 'WiFi Cepat', 'Smart TV', 'Kamar Mandi Dalam', 'Water Heater'],
      publicFacilities: isVilla
        ? ['Carport Luas', 'Taman Pribadi', 'Ruang Keluarga', 'BBQ Area', 'Keamanan 24 Jam']
        : ['Parkir Mobil & Motor', 'Ruang Tamu Bersama', 'Dapur Mini', 'Check-in Fleksibel'],
      rules: [
        'Check-in mulai 14:00 WIB, Check-out maksimal 12:00 WIB',
        'Dilarang membawa hewan peliharaan & membuat keributan di atas jam 22:00',
        'Wajib menunjukkan identitas resmi saat check-in',
      ],
      images: [
        villaImages[i % villaImages.length],
        IMAGE_POOL[(i + 1) % IMAGE_POOL.length],
        IMAGE_POOL[(i + 4) % IMAGE_POOL.length],
      ],
      ownerName: OWNER_NAMES[i % OWNER_NAMES.length],
      ownerPhone: `62812349${String(40000 + i).slice(-5)}`,
      ownerId: 1,
      nearbyLandmark: area.landmark,
      latitude: lat,
      longitude: lng,
      isFavorite: false,
      approvalStatus: 'APPROVED',
    });
  }

  return results;
}
