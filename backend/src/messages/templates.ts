import { formatMnt, formatUbTime, ubDate } from '@open-cinema/shared';
import { env } from '../env';

export type Rendered = { subject: string; html: string; text: string };

export type BookingConfirmedView = {
  orderNo: string;
  movieTitle: string;
  branchName: string;
  hallName: string;
  seats: string[];
  startsAt: Date | string;
  total: number;
  ticketUrl: string;
};

export type ShowtimeCancelledView = {
  movieTitle: string;
  branchName: string;
  startsAt: Date | string;
  refundNote: string;
};

const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const when = (d: Date | string) => `${ubDate(d)} ${formatUbTime(d)}`;

/** Table layout with inline styles only: the email provider strips scripts, forms and iframes. */
function layout(operator: string, title: string, rows: [string, string][], footer?: string) {
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#6b6b73;font-size:14px">${esc(k)}</td>` +
        `<td style="padding:6px 0;color:#111114;font-size:14px;text-align:right">${esc(v)}</td></tr>`,
    )
    .join('');
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:24px 0"><tr><td align="center">` +
    `<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:24px;font-family:Arial,Helvetica,sans-serif">` +
    `<tr><td style="font-size:13px;color:#6b6b73;padding-bottom:12px">${esc(operator)}</td></tr>` +
    `<tr><td style="font-size:20px;font-weight:600;color:#111114;padding-bottom:12px">${esc(title)}</td></tr>` +
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>` +
    (footer
      ? `<tr><td style="padding-top:16px;font-size:13px;color:#6b6b73">${footer}</td></tr>`
      : '') +
    `</table></td></tr></table>`
  );
}

export function otpSms(code: string, operator = env.WESEND_FROM_NAME): string {
  return `${operator} код: ${code}`;
}

export function otpEmail(code: string, operator = env.WESEND_FROM_NAME): Rendered {
  const subject = `${operator}: нэвтрэх код`;
  const html = layout(
    operator,
    'Нэвтрэх код',
    [['Код', code]],
    '5 минутын дотор ашиглана уу. Хэн нэгэнд бүү хэлээрэй.',
  );
  return { subject, html, text: `${operator} нэвтрэх код: ${code}\n5 минутын дотор ашиглана уу.` };
}

export function bookingConfirmedEmail(
  v: BookingConfirmedView,
  operator = env.WESEND_FROM_NAME,
): Rendered {
  const seats = v.seats.join(', ');
  const link = `<a href="${esc(v.ticketUrl)}" style="color:#2e6bf0">Тасалбараа харах</a>`;
  const html = layout(
    operator,
    `Захиалга баталгаажлаа ${v.orderNo}`,
    [
      ['Кино', v.movieTitle],
      ['Салбар', v.branchName],
      ['Танхим', v.hallName],
      ['Суудал', seats],
      ['Цаг', when(v.startsAt)],
      ['Нийт', formatMnt(v.total)],
    ],
    link,
  );
  const text = [
    `Захиалга баталгаажлаа ${v.orderNo}`,
    `${v.movieTitle}, ${v.branchName}, ${v.hallName}`,
    `Суудал: ${seats}`,
    `Цаг: ${when(v.startsAt)}`,
    `Нийт: ${formatMnt(v.total)}`,
    `Тасалбар: ${v.ticketUrl}`,
  ].join('\n');
  return { subject: `${operator}: захиалга ${v.orderNo} баталгаажлаа`, html, text };
}

export function showtimeCancelledEmail(
  v: ShowtimeCancelledView,
  operator = env.WESEND_FROM_NAME,
): Rendered {
  const html = layout(
    operator,
    'Үзвэр цуцлагдлаа',
    [
      ['Кино', v.movieTitle],
      ['Салбар', v.branchName],
      ['Цаг', when(v.startsAt)],
    ],
    esc(v.refundNote),
  );
  const text = `Үзвэр цуцлагдлаа\n${v.movieTitle}, ${v.branchName}, ${when(v.startsAt)}\n${v.refundNote}`;
  return { subject: `${operator}: үзвэр цуцлагдлаа`, html, text };
}
