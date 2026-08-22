import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api, type GradeDetail, type GradeHit } from "../../lib/api";
import { Field, Input } from "../../lib/inputs";
import { theme } from "../../lib/theme";
import { Card, Caveat, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../lib/ui";

/**
 * Grade Finder.
 *
 * Works in both directions. A customer almost never names a GAIL grade — they
 * name what they buy today, so searching an IOCL or RIL code has to return the
 * GAIL grade that substitutes for it.
 */
export default function GradesScreen() {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<GradeHit[]>([]);
  const [detail, setDetail] = useState<GradeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(value: string) {
    setTerm(value);
    setDetail(null);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    try {
      setHits(await api.searchGrades(value.trim()));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    }
  }

  async function open(gailGrade: string) {
    setBusy(true);
    setError(null);
    try {
      setDetail(await api.gradeDetail(gailGrade));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that grade.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <SectionTitle>Find a grade</SectionTitle>
        <Field
          label="Grade or application"
          hint="Try a GAIL code, a competitor code, or what it is used for"
        >
          <Input
            value={term}
            onChangeText={search}
            autoCapitalize="characters"
            placeholder="012DB54, B52A003, blow moulding"
          />
        </Field>
      </Card>

      {error ? <ErrorNote message={error} /> : null}

      {!detail && hits.length ? (
        <Card>
          <SectionTitle>{hits.length} matches</SectionTitle>
          {hits.map((hit) => (
            <Pressable
              key={hit.gailGrade}
              style={styles.hit}
              onPress={() => open(hit.gailGrade)}
            >
              <View style={styles.hitHead}>
                <Text style={styles.hitGrade}>{hit.gailGrade}</Text>
                {hit.confidence && hit.confidence !== "H" ? (
                  <Pill label={`CONF ${hit.confidence}`} color={theme.color.matched} />
                ) : null}
              </View>
              <Text style={styles.hitMeta}>
                {[hit.polymer, hit.application, hit.characteristic]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <Text style={styles.hitVia}>matched via {hit.matchedVia}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {busy ? <Loading label="Loading grade" /> : null}

      {detail ? (
        <>
          <Card>
            <View style={styles.detailHead}>
              <Text style={styles.detailGrade}>{detail.gailGrade}</Text>
              <Pressable onPress={() => setDetail(null)} hitSlop={12}>
                <Text style={styles.back}>Back</Text>
              </Pressable>
            </View>
            <Text style={styles.detailMeta}>
              {[detail.polymer, detail.application, detail.characteristic]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <View style={styles.specs}>
              {detail.process ? <Spec label="Process" value={detail.process} /> : null}
              {detail.mfi ? <Spec label="MFI" value={detail.mfi} /> : null}
              {detail.density ? <Spec label="Density" value={detail.density} /> : null}
            </View>
            {detail.caveat ? <Caveat>{detail.caveat}</Caveat> : null}
          </Card>

          <Card>
            <SectionTitle>Equivalent grades</SectionTitle>
            {detail.equivalents.map((row) => (
              <View key={row.producer} style={styles.equivRow}>
                <Text style={styles.equivProducer}>{row.producer}</Text>
                <View style={styles.equivCodes}>
                  {row.codes.length ? (
                    row.codes.map((code) => (
                      <View
                        key={code.code}
                        style={[
                          styles.code,
                          !code.inCurrentCircular && styles.codeStale,
                        ]}
                      >
                        <Text
                          style={[
                            styles.codeText,
                            !code.inCurrentCircular && styles.codeTextStale,
                          ]}
                        >
                          {code.code}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.none}>no equivalent</Text>
                  )}
                </View>
              </View>
            ))}
            <Text style={styles.footnote}>
              A dimmed code is in the cross-reference but not in the current
              circular — it may have been renamed or withdrawn.
            </Text>
          </Card>

          {detail.international.length ? (
            <Card>
              <SectionTitle>Imported equivalents</SectionTitle>
              <Text style={styles.international}>
                {detail.international.join(" · ")}
              </Text>
            </Card>
          ) : null}
        </>
      ) : null}

      {!hits.length && !detail && !busy ? (
        <Empty>Search by grade code or by what the customer makes.</Empty>
      ) : null}
    </ScrollView>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.spec}>
      <Text style={styles.specLabel}>{label}</Text>
      <Text style={styles.specValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  hit: {
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingVertical: theme.space(3),
  },
  hitHead: { flexDirection: "row", alignItems: "center", gap: theme.space(2) },
  hitGrade: { color: theme.color.text, fontSize: 15, fontWeight: "700" },
  hitMeta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  hitVia: { color: theme.color.textFaint, fontSize: 11, marginTop: 2 },
  detailHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailGrade: { color: theme.color.text, fontSize: 22, fontWeight: "800" },
  back: { color: theme.color.accent, fontSize: 13, fontWeight: "600" },
  detailMeta: { color: theme.color.textMuted, fontSize: 13, marginTop: 2 },
  specs: { flexDirection: "row", gap: theme.space(6), marginTop: theme.space(3) },
  spec: {},
  specLabel: { color: theme.color.textFaint, fontSize: 10 },
  specValue: { color: theme.color.text, fontSize: 13, fontWeight: "600" },
  equivRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: theme.space(2),
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  equivProducer: {
    color: theme.color.textMuted,
    fontSize: 12,
    fontWeight: "700",
    width: 56,
  },
  equivCodes: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: theme.space(2) },
  code: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(2),
    paddingVertical: 3,
  },
  codeStale: { opacity: 0.45 },
  codeText: { color: theme.color.text, fontSize: 12, fontWeight: "600" },
  codeTextStale: { textDecorationLine: "line-through" },
  none: { color: theme.color.textFaint, fontSize: 12, fontStyle: "italic" },
  footnote: {
    color: theme.color.textFaint,
    fontSize: 11,
    lineHeight: 16,
    marginTop: theme.space(2),
  },
  international: { color: theme.color.textMuted, fontSize: 12, lineHeight: 20 },
});
