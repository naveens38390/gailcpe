import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { theme } from "../../../lib/theme";
import { Card, ExportButtons, SectionTitle } from "../../../lib/ui";

/**
 * Master Data Management — the answer to "how do they keep this current
 * without Excel." Each module replaces one of the 14 source files with a
 * Draft -> Review -> Approved -> Published workflow: audited, versioned,
 * and rollback-able, instead of a spreadsheet someone emails around.
 */
const MODULES: Array<{
  key: string;
  title: string;
  subtitle: string;
  route?: string;
}> = [
  { key: "producers", title: "Producers", subtitle: "GAIL, RIL, IOCL, HMEL, OPaL, HPL", route: "/admin/producers" },
  { key: "locations", title: "Locations", subtitle: "313 towns and their producer zone mappings", route: "/admin/locations" },
  { key: "grades", title: "Grade Mappings", subtitle: "44 grades, equivalents, confidence, status", route: "/admin/grades" },
  { key: "discounts", title: "Discount Terms", subtitle: "Cash discount, EPI, IFC, quantity slabs", route: "/admin/discounts" },
  { key: "priceBook", title: "Price Book", subtitle: "Search GAIL's 16,589-row live price matrix", route: "/admin/price-book" },
  { key: "priceCirculars", title: "Price Circulars", subtitle: "Create, edit, review, publish — the circular as one revision", route: "/admin/price-circulars" },
  { key: "freightCirculars", title: "Freight Circulars", subtitle: "Replaces freight spreadsheets" },
];

export default function AdminIndexScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <Card>
        <SectionTitle>Master data</SectionTitle>
        <Text style={styles.intro}>
          Every source file this system used to depend on becomes an editable,
          audited, versioned module here. Excel and PDF become outputs, not
          inputs.
        </Text>
      </Card>

      {MODULES.map((m) => (
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  intro: { color: theme.color.textMuted, fontSize: 13, lineHeight: 19 },
  reportLabel: { color: theme.color.text, fontSize: 13, fontWeight: "700", marginTop: theme.space(3) },
  moduleCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    marginBottom: theme.space(2),
  },
  moduleDisabled: { opacity: 0.5 },
  moduleTitle: { color: theme.color.text, fontSize: 15, fontWeight: "700" },
  moduleSubtitle: { color: theme.color.textFaint, fontSize: 12, marginTop: 2 },
  chevron: { color: theme.color.textFaint, fontSize: 22 },
});
