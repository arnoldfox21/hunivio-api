import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';

export type DuitkuMappedStatus = 'PAID' | 'PENDING' | 'EXPIRED' | 'FAILED';

export interface CreateDuitkuInvoiceParams {
  merchantOrderId: string;
  amount: number;
  productDetails: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  callbackUrl: string;
  returnUrl: string;
  expiryPeriodMinutes?: number;
  itemDetails?: Array<{ name: string; price: number; quantity: number }>;
}

export interface CreateDuitkuInvoiceResult {
  reference: string;
  paymentUrl: string;
  merchantCode: string;
}

export interface DuitkuStatusResult {
  notFound: boolean;
  mappedStatus: DuitkuMappedStatus;
  amount?: number;
  reference?: string;
  statusCode?: string;
  statusMessage?: string;
}

@Injectable()
export class DuitkuService {
  private readonly logger = new Logger(DuitkuService.name);

  private get config() {
    const isProd = process.env.DUITKU_IS_PRODUCTION === 'true';
    const merchantCode = (process.env.DUITKU_MERCHANT_CODE || '').trim();
    const apiKey = (process.env.DUITKU_API_KEY || '').trim();

    if (!merchantCode || !apiKey) {
      throw new InternalServerErrorException(
        'Konfigurasi Duitku (DUITKU_MERCHANT_CODE / DUITKU_API_KEY) belum tersedia.',
      );
    }

    return {
      isProd,
      merchantCode,
      apiKey,
      popBaseUrl: isProd
        ? 'https://api-prod.duitku.com'
        : 'https://api-sandbox.duitku.com',
      v2BaseUrl: isProd
        ? 'https://passport.duitku.com'
        : 'https://sandbox.duitku.com',
    };
  }

  isConfigured(): boolean {
    return Boolean(
      (process.env.DUITKU_MERCHANT_CODE || '').trim() &&
        (process.env.DUITKU_API_KEY || '').trim(),
    );
  }

  mapResultCode(code?: string | null): DuitkuMappedStatus {
    const normalized = String(code || '').trim();
    if (normalized === '00') return 'PAID';
    if (normalized === '01') return 'PENDING';
    if (normalized === '02') return 'EXPIRED';
    return 'PENDING';
  }

  mapCallbackResultCode(code?: string | null): DuitkuMappedStatus {
    const normalized = String(code || '').trim();
    if (normalized === '00') return 'PAID';
    if (normalized === '01') return 'FAILED';
    if (normalized === '02') return 'EXPIRED';
    return 'PENDING';
  }

  async createInvoice(
    params: CreateDuitkuInvoiceParams,
  ): Promise<CreateDuitkuInvoiceResult> {
    const { merchantCode, apiKey, popBaseUrl } = this.config;
    const timestamp = Date.now().toString();
    const signature = crypto
      .createHash('sha256')
      .update(`${merchantCode}${timestamp}${apiKey}`)
      .digest('hex');

    const safeEmail =
      (params.customerEmail || '').trim() || 'noreply@keyloka.com';
    const safeName = (params.customerName || '').trim() || 'Pengguna Keyloka';
    const safePhone = (params.customerPhone || '').trim() || undefined;
    const amount = Math.round(Number(params.amount));

    const payload = {
      paymentAmount: amount,
      merchantOrderId: params.merchantOrderId,
      productDetails: params.productDetails,
      email: safeEmail,
      phoneNumber: safePhone,
      customerVaName: safeName.slice(0, 50),
      callbackUrl: params.callbackUrl,
      returnUrl: params.returnUrl,
      expiryPeriod: params.expiryPeriodMinutes ?? 1440,
      itemDetails: params.itemDetails ?? [
        {
          name: params.productDetails,
          price: amount,
          quantity: 1,
        },
      ],
    };

    const response = await fetch(`${popBaseUrl}/api/merchant/createInvoice`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-duitku-merchantcode': merchantCode,
        'x-duitku-timestamp': timestamp,
        'x-duitku-signature': signature,
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as {
      reference?: string;
      paymentUrl?: string;
      statusCode?: string;
      statusMessage?: string;
      Message?: string;
    };

    if (!response.ok || !data.reference || !data.paymentUrl) {
      this.logger.error(
        `createInvoice failed [${response.status}] (${popBaseUrl}, orderId=${params.merchantOrderId}): ${JSON.stringify(data)}`,
      );
      const msg =
        data.statusMessage ||
        data.Message ||
        'Gagal membuat transaksi pembayaran Duitku.';
      throw new BadRequestException(`Duitku: ${msg}`);
    }

    return {
      reference: data.reference,
      paymentUrl: data.paymentUrl,
      merchantCode,
    };
  }

  async checkTransactionStatus(
    merchantOrderId: string,
  ): Promise<DuitkuStatusResult> {
    const { merchantCode, apiKey, v2BaseUrl } = this.config;
    const signature = crypto
      .createHash('md5')
      .update(`${merchantCode}${merchantOrderId}${apiKey}`)
      .digest('hex');

    const response = await fetch(
      `${v2BaseUrl}/webapi/api/merchant/transactionStatus`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchantCode,
          merchantOrderId,
          signature,
        }),
      },
    );

    if (response.status === 404) {
      return { notFound: true, mappedStatus: 'PENDING' };
    }

    const data = (await response.json().catch(() => ({}))) as {
      merchantOrderId?: string;
      reference?: string;
      amount?: string;
      statusCode?: string;
      statusMessage?: string;
      Message?: string;
    };

    if (!response.ok) {
      if (
        response.status === 400 &&
        String(data.Message || '').toLowerCase().includes('not found')
      ) {
        return { notFound: true, mappedStatus: 'PENDING' };
      }
      throw new BadRequestException(
        data.statusMessage ||
          data.Message ||
          'Gagal memeriksa status pembayaran Duitku.',
      );
    }

    const parsedAmount = data.amount
      ? Math.round(Number(data.amount))
      : undefined;

    return {
      notFound: false,
      mappedStatus: this.mapResultCode(data.statusCode),
      amount: Number.isFinite(parsedAmount) ? parsedAmount : undefined,
      reference: data.reference,
      statusCode: data.statusCode,
      statusMessage: data.statusMessage,
    };
  }

  verifyCallbackSignature(params: {
    merchantCode: string;
    amount: string;
    merchantOrderId: string;
    signature: string;
  }): boolean {
    const { merchantCode, apiKey } = this.config;
    if (params.merchantCode !== merchantCode) {
      return false;
    }
    const expected = crypto
      .createHash('md5')
      .update(
        `${params.merchantCode}${params.amount}${params.merchantOrderId}${apiKey}`,
      )
      .digest('hex')
      .toLowerCase();
    return expected === params.signature.trim().toLowerCase();
  }
}
