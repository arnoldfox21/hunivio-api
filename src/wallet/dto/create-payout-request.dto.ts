import { IsInt, IsNotEmpty, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreatePayoutRequestDto {
  @IsInt()
  @Min(10000)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  bankName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(64)
  accountNumber: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  accountHolder: string;
}
