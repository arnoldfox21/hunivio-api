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

  @Column({ default: 'Campur' })
  type: string; // 'Putra' | 'Putri' | 'Campur'

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

  @Column({ default: '' })
  nearbyLandmark: string;

  @Column({ default: false })
  isFavorite: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
