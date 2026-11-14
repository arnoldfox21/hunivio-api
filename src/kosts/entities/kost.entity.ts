import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('kosts')
export class Kost {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ default: 'KOST' })
  propertyCategory: string; // 'KOST' | 'APARTEMEN' | 'KONTRAKAN'

  @Column({ default: 'Campur' })
  type: string; // 'Putra' | 'Putri' | 'Campur' | 'Umum'

  @Column()
  city: string;

  @Column()
  district: string;

  @Column()
  address: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'int' })
  pricePerMonth: number;

  @Column({ type: 'int', nullable: true })
  pricePerDay: number | null;

  @Column({ type: 'int', nullable: true })
  pricePerYear: number | null;

  @Column({ type: 'int', default: 0 })
  depositAmount: number;

  @Column({ type: 'int', nullable: true })
  originalPrice: number;

  @Column({ type: 'int', default: 0 })
  discountPercent: number;

  @Column({ type: 'float', default: 4.7 })
  rating: number;

  @Column({ type: 'int', default: 10 })
  reviewCount: number;

  @Column({ type: 'int', default: 3 })
  availableRooms: number;

  @Column({ type: 'int', default: 12 })
  totalRooms: number;

  @Column({ default: '3 x 4 m' })
  roomSize: string;

  @Column({ default: '' })
  unitType: string; // e.g., 'Studio', '1BR', '2BR', 'Rumah 2 Lantai'

  @Column({ default: '' })
  furnishing: string; // 'Furnished' | 'Semi-Furnished' | 'Unfurnished'

  @Column({ type: 'int', nullable: true })
  floorLevel: number | null;

  @Column({ type: 'int', nullable: true })
  buildingArea: number | null;

  @Column({ type: 'int', nullable: true })
  landArea: number | null;

  @Column({ type: 'int', default: 1 })
  bedrooms: number;

  @Column({ type: 'int', default: 1 })
  bathrooms: number;

  @Column({ default: false })
  hasCarport: boolean;

  @Column({ default: true })
  isVerified: boolean;

  @Column({ default: false })
  electricityIncluded: boolean;

  @Column({ default: true })
  isSinggahsini: boolean;

  @Column({ default: true })
  isInstantBooking: boolean;

  @Column({ type: 'jsonb', default: [] })
  roomFacilities: string[];

  @Column({ type: 'jsonb', default: [] })
  publicFacilities: string[];

  @Column({ type: 'jsonb', default: [] })
  rules: string[];

  @Column({ type: 'jsonb', default: [] })
  images: string[];

  @Column({ default: 'Pengelola Kost' })
  ownerName: string;

  @Column({ default: '6281234567890' })
  ownerPhone: string;

  @Column({ type: 'int', default: 1 })
  ownerId: number;

  @Column({ default: '' })
  nearbyLandmark: string;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ default: false })
  isFavorite: boolean;

  @Column({ default: 'APPROVED' })
  approvalStatus: string; // 'PENDING' | 'APPROVED' | 'REJECTED'

  @Column({ type: 'text', default: '' })
  rejectionReason: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
