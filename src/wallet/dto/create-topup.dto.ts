import { IsInt, Min, Max } from 'class-validator';

export class CreateTopupDto {
  @IsInt({ message: 'Nominal top-up harus berupa angka bulat.' })
  @Min(10000, { message: 'Minimal top-up adalah Rp 10.000.' })
  @Max(10000000, { message: 'Maksimal top-up sekali transaksi adalah Rp 10.000.000.' })
  amount: number;
}
