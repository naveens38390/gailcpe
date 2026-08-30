import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";

import {
  api,
  type CircularExtractResult,
  type CircularRecord,
} from "../../services/api";
import { Field, Input, PrimaryButton } from "../../components/inputs";
import { SelectField, type Option } from "../../components/select";
import { useCatalog } from "../../context/catalog";
import { theme } from "../../theme";
import { Card, Caveat, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

/**
 * Circulars — the front door for a new price round.
 *
 * A circular arrives as a document and becomes a reviewable draft in two
 * deliberate steps: file the document, then attach the reading taken from it.
 * Neither step touches a published price. The draft that comes out is the same
 * one the existing review screen already knows how to approve and publish, so
 * this screen hands off rather than duplicating that workflow.
 */
export default function CircularsScreen() {
  const styles = useStyles();
  const [items, setItems] = useState<CircularRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.circulars();
      // Newest round first — the one someone is most likely acting on.
      const all = [...list.price, ...list.freight].sort((a, b) =>
        String(b.effectiveDate).localeCompare(String(a.effectiveDate)),
      );
      setItems(all);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load circulars.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <UploadForm onFiled={load} />
      {error ? <ErrorNote message={error} /> : null}
      {loading ? <Loading label="Loading circulars" /> : null}

      {!loading && items.length ? (
        <Card>
          <SectionTitle>On file ({items.length})</SectionTitle>
          {items.map((c) => (
            <CircularRow key={String(c._id)} circular={c} onChanged={load} />
          ))}
        </Card>
      ) : null}

      {!loading && !items.length ? <Empty>No circulars have been filed yet.</Empty> : null}
    </ScrollView>
  );
}

/** Step one: the document itself, recorded against a producer and a round. */
function UploadForm({ onFiled }: { onFiled: () => void }) {
  const styles = useStyles();
  const { catalog, loading: catalogLoading } = useCatalog();
  const [producer, setProducer] = useState("");
  const [reference, setReference] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState<string | null>(null);

  const producerOptions: Option[] = useMemo(
    () =>
      (catalog?.producers ?? []).map((p) => ({
        value: p.code,
        label: p.code,
        detail: p.name,
        badge: p.isSelf ? "US" : undefined,
      })),
    [catalog],
  );

  /**
   * Choosing the document also reads its reference number out of it, so the
   * commonest typo — a mistyped circular number — mostly stops happening. The
   * field stays editable and a failed read says so rather than sitting blank
   * for no visible reason.
   */
  async function pick() {
    setError(null);
    setDetectNote(null);
    const file = await pickFile(["application/pdf", "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
    if (!file) return;
    setPicked(file);

    setDetecting(true);
    try {
      const form = new FormData();
      appendFile(form, file);
      const found = await api.detectCircularReference(form);
      if (found.reference) {
        setReference(found.reference);
        setDetectNote(`Read from the document: ${found.reference}`);
      } else {
        setDetectNote("Circular number could not be detected automatically.");
      }
    } catch {
      // Detection is a convenience; never let it stop someone filing.
      setDetectNote("Circular number could not be detected automatically.");
    } finally {
      setDetecting(false);
    }
  }

  async function submit() {
    setError(null);
    if (!picked) return setError("Choose the circular document first.");
    if (!producer.trim() || !reference.trim() || !effectiveDate.trim()) {
      return setError("Producer, circular number and effective date are all needed.");
    }
    setBusy(true);
    try {
      const form = new FormData();
      appendFile(form, picked);
      form.append("kind", "price");
      form.append("producer", producer.trim().toUpperCase());
      form.append("reference", reference.trim());
      form.append("effectiveDate", effectiveDate.trim());
      const result = await api.uploadCircular(form);
      setFiled(`${result.producer} ${result.reference} filed — ${result.documentType}, ${(result.bytes / 1024).toFixed(0)}KB`);
      setPicked(null);
      setProducer("");
      setReference("");
      setEffectiveDate("");
      onFiled();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not file that circular.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle>File a circular</SectionTitle>
      <Text style={styles.note}>
        Recording the document changes no price. Attaching its reading afterwards
        produces a draft, and publishing that draft stays a separate decision.
      </Text>

      {/* Sourced from the running dataset, not a list in the code: retiring a
          producer removes it from this form without a release. */}
      <SelectField
        label="Producer"
        placeholder="Choose the producer"
        hint="Only producers the pricing engine carries"
        value={producer}
        options={producerOptions}
        onChange={setProducer}
        loading={catalogLoading}
        emptyText="No producers are loaded."
      />
      <Field label="Circular number"><Input value={reference} onChangeText={setReference} placeholder="PE/2026-27/019" /></Field>
      <Field label="Effective date" hint="YYYY-MM-DD — when it takes effect, not today">
        <Input value={effectiveDate} onChangeText={setEffectiveDate} placeholder="2026-10-01" />
      </Field>

      <Pressable onPress={pick} style={styles.picker} disabled={detecting}>
        <Text style={styles.pickerText}>
          {detecting
            ? "Reading the document…"
            : picked
              ? picked.name
              : "Choose a PDF or Excel circular"}
        </Text>
      </Pressable>

      {detectNote ? <Text style={styles.detectNote}>{detectNote}</Text> : null}

      {error ? <ErrorNote message={error} /> : null}
      {filed ? <Caveat>{filed}</Caveat> : null}
      <PrimaryButton label="File circular" onPress={submit} busy={busy} />
    </Card>
  );
}

/** A filed circular, with whatever step it is waiting on. */
function CircularRow({ circular, onChanged }: { circular: CircularRecord; onChanged: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CircularExtractResult | null>(null);

  const id = String(circular._id);
  const hasDraft = Boolean(circular.draft);
  const isPrice = circular.kind === "price";

  async function attach() {
    setError(null);
    const file = await pickFile(["application/json"]);
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      appendFile(form, file);
      setResult(await api.attachCircularExtract(id, form));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that extract.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>
          {circular.producer} · {circular.reference ?? "no reference"}
        </Text>
        <Pill
          label={hasDraft ? "DRAFTED" : "AWAITING EXTRACT"}
          color={hasDraft ? colors.success : colors.warning}
        />
      </View>
      <Text style={styles.rowMeta}>
        {String(circular.effectiveDate).slice(0, 10)} · {circular.kind}
        {circular.sourceFilename ? ` · ${circular.sourceFilename}` : ""}
        {circular.uploadedAt ? ` · filed ${String(circular.uploadedAt).slice(0, 10)}` : ""}
      </Text>

      <View style={styles.actions}>
        <Pressable onPress={() => openSource(id)} hitSlop={8}>
          <Text style={styles.link}>Open document</Text>
        </Pressable>

        {isPrice && !hasDraft ? (
          <Pressable onPress={attach} disabled={busy} hitSlop={8}>
            <Text style={styles.link}>{busy ? "Reading…" : "Attach extract"}</Text>
          </Pressable>
        ) : null}

        {hasDraft ? (
          <Pressable
            onPress={() => router.push(`/admin/price-circular/${String(circular.draft)}` as never)}
            hitSlop={8}
          >
            <Text style={styles.link}>Review draft</Text>
          </Pressable>
        ) : null}
      </View>

      {!isPrice && !hasDraft ? (
        <Text style={styles.rowMeta}>Freight circulars have no draft model yet.</Text>
      ) : null}

      {error ? <ErrorNote message={error} /> : null}
      {result ? <ExtractSummary result={result} /> : null}
    </View>
  );
}

/**
 * What the reading actually said.
 *
 * Removals get the loudest treatment: a partial or half-parsed extract looks
 * exactly like a complete circular until someone notices that thousands of
 * live rows went unmentioned, and by then it is published.
 */
function ExtractSummary({ result }: { result: CircularExtractResult }) {
  const styles = useStyles();
  const suspicious = result.removedCount > 0;
  return (
    <View style={styles.summary}>
      <View style={styles.counts}>
        <Count label="rows read" value={result.rowCount} />
        <Count label="changed" value={result.changedRowCount} />
        <Count label="added" value={result.addedCount} />
        <Count label="unmentioned" value={result.removedCount} warn={suspicious} />
      </View>
      {suspicious ? (
        <Caveat>
          {result.removedCount.toLocaleString("en-IN")} rows in the live book are
          not in this reading. Publishing this draft would withdraw them — check
          the extract covers the whole circular before approving.
        </Caveat>
      ) : null}
      {result.added.length ? (
        <Text style={styles.summaryLine}>
          New: {result.added.slice(0, 6).join(", ")}
          {result.addedCount > 6 ? ` +${result.addedCount - 6} more` : ""}
        </Text>
      ) : null}
    </View>
  );
}

function Count({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.count}>
      <Text style={[styles.countValue, warn && styles.countWarn]}>
        {value.toLocaleString("en-IN")}
      </Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

interface PickedFile {
  name: string;
  uri: string;
  mimeType?: string;
  /** Web hands back a real File; native gives a uri to reference. */
  file?: unknown;
}

/** One picker for both platforms; the shape they return differs. */
async function pickFile(types: string[]): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0]!;
  return {
    name: asset.name,
    uri: asset.uri,
    mimeType: asset.mimeType,
    file: (asset as { file?: unknown }).file,
  };
}

/**
 * Put the picked file on a FormData.
 *
 * Web has a real File object and must send that; React Native wants the
 * uri/name/type triple instead, which its own fetch understands.
 */
function appendFile(form: FormData, picked: PickedFile): void {
  if (Platform.OS === "web" && picked.file) {
    form.append("file", picked.file as Blob, picked.name);
    return;
  }
  form.append("file", {
    uri: picked.uri,
    name: picked.name,
    type: picked.mimeType ?? "application/octet-stream",
  } as unknown as Blob);
}

function openSource(id: string): void {
  Linking.openURL(api.circularSourceUrl(id)).catch(() => {
    /* nothing useful to say if the OS refuses to open it */
  });
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  note: { color: c.textMuted, fontSize: 13, lineHeight: 19, marginBottom: theme.space(2) },

  picker: {
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: "dashed",
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(3),
    paddingHorizontal: theme.space(3),
    alignItems: "center",
    marginTop: theme.space(2),
    backgroundColor: c.surfaceAlt,
  },
  pickerText: { color: c.textMuted, fontSize: 13, fontWeight: "600" },
  detectNote: { color: c.textFaint, fontSize: 12, marginTop: theme.space(2), lineHeight: 17 },

  row: { paddingVertical: theme.space(3), borderTopWidth: 1, borderTopColor: c.border },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: theme.space(2) },
  rowTitle: { color: c.textPrimary, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  rowMeta: { color: c.textFaint, fontSize: 11, marginTop: 2 },
  actions: { flexDirection: "row", gap: theme.space(4), marginTop: theme.space(2), flexWrap: "wrap" },
  link: { color: c.primary, fontSize: 13, fontWeight: "700" },

  summary: { marginTop: theme.space(3), gap: theme.space(2) },
  counts: { flexDirection: "row", gap: theme.space(4), flexWrap: "wrap" },
  count: { minWidth: 72 },
  countValue: { color: c.textPrimary, fontSize: 16, fontWeight: "800" },
  countWarn: { color: c.danger },
  countLabel: { color: c.textFaint, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 },
  summaryLine: { color: c.textMuted, fontSize: 12, lineHeight: 17 },
}));
