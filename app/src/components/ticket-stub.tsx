import { formatUbTime, type TicketView, ubDate } from '@open-cinema/shared';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { type Locale, useI18n } from '@/i18n';
import { formatMonthDay } from '@/lib/format';
import { mediaUrl } from '@/lib/http';
import { colors, radius, space } from '@/theme/tokens';
import { fonts, type } from '@/theme/type';

const NOTCH = 22;

type T = ReturnType<typeof useI18n>['t'];

/** Screen-reader summary shared by the stub and the My tickets row: film, date, time, hall, seat, status. */
export function ticketSummary(ticket: TicketView, t: T, locale: Locale): string {
  const status =
    ticket.status === 'cancelled'
      ? t('ticket.cancelledNote')
      : ticket.usedAt
        ? t('ticket.used')
        : null;
  return [
    ticket.movie.title,
    formatMonthDay(ubDate(ticket.showtime.startsAt), locale),
    formatUbTime(ticket.showtime.startsAt),
    ticket.hallName,
    `${t('ticket.seat')} ${ticket.seat.rowLabel}${ticket.seat.number}`,
    status,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Paper ticket: film-tone band, perforation with notches, the seat code very large, entry QR. */
export function TicketStub({ ticket }: { ticket: TicketView }) {
  const { t, locale } = useI18n();
  const seat = `${ticket.seat.rowLabel}${ticket.seat.number}`;
  const cancelled = ticket.status === 'cancelled';
  const used = ticket.usedAt !== null;
  const dim = cancelled || used;

  return (
    <View style={styles.wrap} accessible accessibilityLabel={ticketSummary(ticket, t, locale)}>
      <View style={styles.band}>
        <Image
          source={mediaUrl(ticket.movie.backdropUrl ?? ticket.movie.posterUrl)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={process.env.EXPO_OS === 'ios' ? 40 : 20}
        />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: ticket.movie.tone, opacity: 0.55 }]}
        />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.canvas, opacity: 0.35 }]}
        />
        <Text style={styles.title} numberOfLines={2}>
          {ticket.movie.title}
        </Text>
        <Text style={styles.bandMeta} numberOfLines={1}>
          {ticket.branch.name}
        </Text>
      </View>

      <View style={[styles.paper, styles.top]}>
        <View style={styles.facts}>
          <Fact
            grow={1.6}
            label={t('ticket.date')}
            value={formatMonthDay(ubDate(ticket.showtime.startsAt), locale)}
          />
          <Fact
            grow={0.9}
            label={t('ticket.time')}
            value={formatUbTime(ticket.showtime.startsAt)}
          />
          <Fact grow={1.1} label={t('ticket.hall')} value={ticket.hallName} />
        </View>
      </View>

      <View style={styles.perf}>
        <View style={[styles.notch, styles.notchL]} />
        <View style={styles.dashes} />
        <View style={[styles.notch, styles.notchR]} />
      </View>

      <View style={[styles.paper, styles.bottom]}>
        <View style={[styles.codeBlock, dim && styles.dim]}>
          <Text style={styles.seatLabel}>{t('ticket.seat')}</Text>
          <Text style={styles.seat} adjustsFontSizeToFit numberOfLines={1}>
            {seat}
          </Text>
          <View style={styles.qr}>
            <QRCode
              value={ticket.qrToken}
              size={176}
              color={colors.paperInk}
              backgroundColor={colors.paper}
              ecl="M"
            />
          </View>
          <Text style={styles.order}>
            {t('ticket.order', { no: ticket.orderNo })} · {t('ticket.checkCode')} {ticket.checkCode}
          </Text>
        </View>
        {cancelled || used ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {cancelled ? t('ticket.cancelledNote') : t('ticket.used')}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Fact({ label, value, grow }: { label: string; value: string; grow: number }) {
  return (
    <View style={[styles.fact, { flexGrow: grow, flexBasis: 0 }]}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.panel, overflow: 'hidden', backgroundColor: colors.paper },
  band: {
    padding: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.lg,
    gap: 2,
    overflow: 'hidden',
    backgroundColor: colors.raised,
  },
  title: { ...type.title, color: colors.ink },
  bandMeta: { ...type.caption, color: colors.body },
  paper: { backgroundColor: colors.paper, paddingHorizontal: space.lg },
  top: { paddingTop: space.lg, paddingBottom: space.lg },
  facts: { flexDirection: 'row', gap: space.md },
  fact: { gap: 2 },
  factLabel: { ...type.footnote, color: colors.paperMuted },
  factValue: { ...type.number, color: colors.paperInk },
  perf: { height: NOTCH, backgroundColor: colors.paper, justifyContent: 'center' },
  dashes: {
    marginHorizontal: NOTCH,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.paperRule,
  },
  notch: {
    position: 'absolute',
    top: 0,
    width: NOTCH,
    height: NOTCH,
    borderRadius: NOTCH / 2,
    backgroundColor: colors.canvas,
  },
  notchL: { left: -NOTCH / 2 },
  notchR: { right: -NOTCH / 2 },
  bottom: { alignItems: 'center', paddingTop: space.md, paddingBottom: space.xl, gap: space.sm },
  codeBlock: { alignItems: 'center', gap: space.sm },
  dim: { opacity: 0.35 },
  seatLabel: { ...type.footnote, color: colors.paperMuted },
  seat: {
    fontFamily: fonts.semibold,
    fontSize: 72,
    lineHeight: 80,
    letterSpacing: -1,
    color: colors.paperInk,
    fontVariant: ['tabular-nums'],
  },
  qr: { padding: space.sm },
  order: { ...type.caption, color: colors.paperMuted, fontVariant: ['tabular-nums'] },
  badge: {
    marginTop: space.xs,
    paddingHorizontal: space.md,
    height: 28,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.paperInk,
  },
  badgeText: { ...type.footnote, color: colors.paper },
});
