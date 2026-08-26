import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { api, type DashboardResponse } from "../../services/api";
import { BarChart, LineChart, RatioBar } from "../../components/charts";
import { KpiCard, KpiGroup, RecentActivityFeed } from "../../components/dashboard";
import { theme } from "../../theme";
import { Card, ErrorNote, ExportButtons, Loading, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

interface ModuleCard {
  key: string;
  title: string;
  subtitle: string;
  route?: string;
}

const MODULES: Record<string, ModuleCard> = {
  producers: { key: "producers", title: "Producers", subtitle: "GAIL, RIL, IOCL, HMEL, OPaL, HPL", route: "/admin/producers" },
  locations: { key: "locations", title: "Locations", subtitle: "313 towns and their producer zone mappings", route: "/admin/locations" },
  grades: { key: "grades", title: "Grade Mappings", subtitle: "44 grades, equivalents, confidence, status", route: "/admin/grades" },
  discounts: { key: "discounts", title: "Discount Terms", subtitle: "Cash discount, EPI, IFC, quantity slabs", route: "/admin/discounts" },
  priceBook: { key: "priceBook", title: "Price Book", subtitle: "Search GAIL's 16,589-row live price matrix", route: "/admin/price-book" },
  circulars: { key: "circulars", title: "Circulars", subtitle: "File a circular, attach its reading, hand the draft to review", route: "/admin/circulars" },
  priceCirculars: { key: "priceCirculars", title: "Price Circulars", subtitle: "Create, edit, review, publish — the circular as one revision", route: "/admin/price-circulars" },
  freightCirculars: { key: "freightCirculars", title: "Freight Circulars", subtitle: "Replaces freight spreadsheets" },
  approvals: { key: "approvals", title: "Approvals", subtitle: "Review pending price corrections — approve, reject, or request changes", route: "/admin/approvals" },
  notifications: { key: "notifications", title: "Notifications", subtitle: "Every correction submitted, approved, rejected, or sent back", route: "/admin/notifications" },
  timeline: { key: "timeline", title: "Change History", subtitle: "Every change by the day it happened — who, which circular, before and after", route: "/admin/timeline" },
  auditLog: { key: "auditLog", title: "Audit Logs", subtitle: "Who changed what, and when", route: "/admin/audit-log" },
};

/**
 * Grouped the way the brief asked (Operations / Master Data / Pricing /
 * System). Two things are deliberately not here: a "Corrections" entry —
 * Approvals already is the corrections management view (see its own header
 * comment) — and "Settings" — no such screen exists anywhere in this app;
 * the one thing that could plausibly be settings (dark mode) already lives
 * one tap away in the drawer.
 */
const NAV_GROUPS: Array<{ title: string; items: ModuleCard[] }> = [
  { title: "Operations", items: [MODULES.approvals!, MODULES.notifications!] },
  { title: "Master Data", items: [MODULES.producers!, MODULES.locations!, MODULES.grades!, MODULES.discounts!] },
  { title: "Pricing", items: [MODULES.priceBook!, MODULES.circulars!, MODULES.priceCirculars!, MODULES.freightCirculars!] },
  { title: "System", items: [MODULES.timeline!, MODULES.auditLog!] },
];

export default function AdminIndexScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      {error ? <ErrorNote message={error} /> : null}
      {loading ? <Loading label="Loading dashboard" /> : null}

      <Card>
        <KpiGroup title="Corrections">
          <KpiCard label="Pending" value={data?.kpis.corrections.pending} color={colors.warning} />
          <KpiCard label="Approved Today" value={data?.kpis.corrections.approvedToday} color={colors.success} />
          <KpiCard label="Rejected" value={data?.kpis.corrections.rejected} color={colors.danger} />
          <KpiCard label="Awaiting Review" value={data?.kpis.corrections.changesRequested} color={colors.primary} />
        </KpiGroup>
        <KpiGroup title="Circulars">
          <KpiCard label="Drafts" value={data?.kpis.circulars.drafts} color={colors.textPrimary} />
          <KpiCard label="Published" value={data?.kpis.circulars.published} color={colors.success} />
          <KpiCard label="Scheduled" value={data?.kpis.circulars.scheduled} color={colors.warning} />
        </KpiGroup>
        <KpiGroup title="Master Data">
          <KpiCard label="Producers" value={data?.kpis.masterData.producers} color={colors.textPrimary} />
          <KpiCard label="Locations" value={data?.kpis.masterData.locations} color={colors.textPrimary} />
          <KpiCard label="Grades" value={data?.kpis.masterData.grades} color={colors.textPrimary} />
          <KpiCard label="Price Book Entries" value={data?.kpis.masterData.priceBookEntries} color={colors.textPrimary} />
        </KpiGroup>
        <KpiGroup title="Activity">
          <KpiCard label="Changes Today" value={data?.kpis.activity.today} color={colors.secondary} />
          <KpiCard label="This Week" value={data?.kpis.activity.thisWeek} color={colors.secondary} />
          <KpiCard label="This Month" value={data?.kpis.activity.thisMonth} color={colors.secondary} />
        </KpiGroup>
      </Card>

      {data ? (
        <Card>
          <SectionTitle>Analytics</SectionTitle>

          <Text style={styles.chartLabel}>Corrections Trend (Last 30 Days)</Text>
          <LineChart data={data.charts.correctionsTrend} color={colors.primary} />

          <Text style={styles.chartLabel}>Approval Rate</Text>
          <RatioBar
            a={{ label: "Approved", value: data.charts.approvalRate.approved, color: colors.success }}
            b={{ label: "Rejected", value: data.charts.approvalRate.rejected, color: colors.danger }}
          />

          <Text style={styles.chartLabel}>Price Updates (Daily Volume)</Text>
          <BarChart data={data.charts.priceUpdates} color={colors.secondary} />

          <Text style={styles.chartLabel}>Circular Publishing Activity (Weekly)</Text>
          <BarChart data={data.charts.circularActivity} color={colors.warning} />
        </Card>
      ) : null}

      {data ? (
        <Card>
          <SectionTitle>Recent Activity</SectionTitle>
          <RecentActivityFeed items={data.recentActivity} />
        </Card>
      ) : null}

      {NAV_GROUPS.map((group) => (
        <Card key={group.title}>
          <SectionTitle>{group.title}</SectionTitle>
          {group.items.map((m) => (
            <Pressable
              key={m.key}
              style={[styles.moduleCard, !m.route && styles.moduleDisabled]}
              disabled={!m.route}
              onPress={() => m.route && router.push(m.route as never)}
            >
              <View>
                <Text style={styles.moduleTitle}>{m.title}</Text>
                <Text style={styles.moduleSubtitle}>{m.subtitle}</Text>
              </View>
              {m.route ? <Text style={styles.chevron}>›</Text> : null}
            </Pressable>
          ))}
        </Card>
      ))}

      <Card>
        <SectionTitle>Reports</SectionTitle>
        <Text style={styles.intro}>
          Generated fresh from published data every time — never a file someone
          edits and re-uploads.
        </Text>

        <Text style={styles.reportLabel}>Discount Circular — GAIL vs Others</Text>
        <ExportButtons
          excel={{ path: "/exports/discount-circular/excel", filename: "DiscountCircular.xlsx" }}
          pdf={{ path: "/exports/discount-circular/pdf", filename: "DiscountCircular.pdf" }}
        />

        <Text style={styles.reportLabel}>Grade Mapping</Text>
        <ExportButtons excel={{ path: "/exports/grade-mapping/excel", filename: "GradeMapping.xlsx" }} />

        <Text style={styles.reportLabel}>Location Master</Text>
        <ExportButtons excel={{ path: "/exports/location-master/excel", filename: "LocationMaster.xlsx" }} />
      </Card>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  intro: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  chartLabel: {
    color: c.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: theme.space(4),
    marginBottom: theme.space(2),
  },
  reportLabel: { color: c.textPrimary, fontSize: 13, fontWeight: "700", marginTop: theme.space(3) },
  moduleCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    marginTop: theme.space(2),
  },
  moduleDisabled: { opacity: 0.5 },
  moduleTitle: { color: c.textPrimary, fontSize: 15, fontWeight: "700" },
  moduleSubtitle: { color: c.textFaint, fontSize: 12, marginTop: 2 },
  chevron: { color: c.textFaint, fontSize: 22 },
}));
