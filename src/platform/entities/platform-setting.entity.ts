import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

@Entity('platform_settings')
export class PlatformSetting {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  @Column({ type: 'int', default: 2 })
  freePropertyQuota: number;

  @Column({ type: 'int', default: 10000 })
  extraPropertySlotFee: number;

  @Column({ type: 'int', default: 1 })
  bookingPlatformFeePercent: number;

  @Column({ type: 'int', default: 10000 })
  minWithdrawAmount: number;

  @Column({ type: 'int', default: 5000 })
  boost3dPrice: number;

  @Column({ type: 'int', default: 10000 })
  boost7dPrice: number;

  @Column({ type: 'int', default: 18000 })
  boost14dPrice: number;

  @Column({ type: 'boolean', default: true })
  allowOwnerRegistration: boolean;

  @Column({ type: 'boolean', default: true })
  allowDirectBookingGlobal: boolean;

  @Column({ type: 'boolean', default: false })
  maintenanceMode: boolean;

  @Column({ type: 'text', default: '' })
  maintenanceMessage: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  opsNotificationEmail: string;

  @Column({ type: 'int', nullable: true })
  updatedByUserId: number | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
