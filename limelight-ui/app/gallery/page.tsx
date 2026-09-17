"use client";

import { useState } from "react";
import { Button, IconButton } from "@/components/primitives/Button";
import { Input, Field } from "@/components/primitives/Input";
import { Panel, EmptyState } from "@/components/primitives/Panel";
import { Badge, StatusDot } from "@/components/primitives/Status";
import { Menu } from "@/components/primitives/Menu";
import { Dialog } from "@/components/primitives/Dialog";

/* Dev-only. The design system's real test is looking at it: every primitive,
   every state, both densities, on the surfaces it will actually sit on. */

type Density = "studio" | "booth";

export function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-[var(--spacing-s2)]">
      <span
        className="w-8 h-8 rounded border border-solid border-line flex-none"
        style={{ background: value }}
      />
      <span className="mono text-[length:var(--text-xs)] text-ink-dim">{name}</span>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-[var(--spacing-s6)] border-b border-solid border-line">
      <h2 className="text-[length:var(--text-lg)] font-medium mb-[var(--spacing-s4)]">{title}</h2>
      <div className="flex flex-wrap items-start gap-[var(--spacing-s5)]">{children}</div>
    </section>
  );
}

export default function GalleryPage() {
  const [density, setDensity] = useState<Density>("studio");
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div
      data-density={density}
      className="h-screen overflow-y-auto bg-bg text-ink px-[var(--spacing-s7)] py-[var(--spacing-s6)]"
    >
      <header className="flex items-baseline justify-between gap-[var(--spacing-s4)] pb-[var(--spacing-s5)]">
        <div>
          <h1 className="text-[length:var(--text-2xl)] font-medium tracking-[-0.02em]">
            Design system
          </h1>
          <p className="text-[length:var(--text-sm)] text-ink-dim mt-1">
            Every primitive, every state. Switch density to check both ergonomics.
          </p>
        </div>
        <div className="flex gap-[var(--spacing-s2)]">
          {(["studio", "booth"] as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              className={`h-[var(--hit)] px-[var(--spacing-s3)] rounded border border-solid cursor-pointer text-[length:var(--text-sm)] transition-colors duration-[var(--dur-state)] ${
                density === d
                  ? "border-line-strong bg-bg-raised text-ink"
                  : "border-line text-ink-dim hover:text-ink"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </header>

      <Section title="Surfaces">
        <Swatch name="--bg-sunken" value="var(--bg-sunken)" />
        <Swatch name="--bg" value="var(--bg)" />
        <Swatch name="--bg-raised" value="var(--bg-raised)" />
        <Swatch name="--bg-overlay" value="var(--bg-overlay)" />
        <Swatch name="--stage" value="var(--stage)" />
      </Section>

      <Section title="Lane families">
        <Swatch name="hits" value="var(--fam-hits)" />
        <Swatch name="darkness" value="var(--fam-darkness)" />
        <Swatch name="strobe" value="var(--fam-strobe)" />
        <Swatch name="lift" value="var(--fam-lift)" />
        <Swatch name="breath" value="var(--fam-breath)" />
        <Swatch name="wash" value="var(--fam-wash)" />
        <Swatch name="dynamics" value="var(--fam-dynamics)" />
      </Section>

      <Section title="Song phases">
        <Swatch name="intro" value="var(--phase-intro)" />
        <Swatch name="drop" value="var(--phase-drop)" />
        <Swatch name="silence" value="var(--phase-silence)" />
        <Swatch name="break" value="var(--phase-break)" />
        <Swatch name="verse" value="var(--phase-verse)" />
        <Swatch name="build" value="var(--phase-build)" />
        <Swatch name="final_drop" value="var(--phase-final-drop)" />
        <Swatch name="outro" value="var(--phase-outro)" />
      </Section>

      <Section title="State">
        <Swatch name="ok" value="var(--ok)" />
        <Swatch name="warn" value="var(--warn)" />
        <Swatch name="danger" value="var(--danger)" />
        <Swatch name="focus / playhead" value="var(--focus)" />
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-[var(--spacing-s2)]">
          <span className="text-[length:var(--text-2xl)]">Display 28</span>
          <span className="text-[length:var(--text-xl)]">Title 22</span>
          <span className="text-[length:var(--text-lg)]">Heading 18</span>
          <span className="text-[length:var(--text-md)]">Emphasis 15</span>
          <span className="text-[length:var(--text-sm)]">Body 13</span>
          <span className="text-[length:var(--text-xs)] text-ink-dim">Meta 12</span>
          <span className="label">Micro label</span>
          <span className="mono">Bar 33 · beat 2 · 0:34.86 · 9494 frames</span>
        </div>
      </Section>

      <Section title="Button">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="primary" disabled>Disabled</Button>
        <IconButton label="Play">▶</IconButton>
        <IconButton label="Snap" active>⌗</IconButton>
        <IconButton label="Delete" disabled>×</IconButton>
      </Section>

      <Section title="Input">
        <Field label="Show name">
          {(id) => <Input id={id} placeholder="Name this show" />}
        </Field>
        <Field label="Seed" hint="changes the whole arrangement">
          {(id) => <Input id={id} defaultValue="1" className="mono w-[80px]" />}
        </Field>
        <Field label="Author" error="that name is taken">
          {(id) => <Input id={id} defaultValue="muzammil" invalid />}
        </Field>
        <Field label="Disabled">
          {(id) => <Input id={id} placeholder="Unavailable" disabled />}
        </Field>
      </Section>

      <Section title="Panel, status">
        <Panel title="Rig" className="w-[280px]" actions={<Badge tone="ok">sending</Badge>}>
          <div className="flex flex-col gap-[var(--spacing-s2)]">
            <StatusDot tone="ok">40 fps to Art-Net 10.0.0.9</StatusDot>
            <StatusDot tone="warn">strobe capped at 120</StatusDot>
            <StatusDot tone="danger">no output — socket closed</StatusDot>
            <StatusDot>standby</StatusDot>
          </div>
        </Panel>
        <Panel title="Shows" className="w-[320px]">
          <EmptyState
            title="No saved shows yet"
            body="Open a song from the library and place your first effect — saving keeps the venue it was designed for."
            action={<Button variant="primary">Browse songs</Button>}
          />
        </Panel>
        <div className="flex gap-[var(--spacing-s2)]">
          <Badge>neutral</Badge>
          <Badge tone="ok">ok</Badge>
          <Badge tone="warn">warn</Badge>
          <Badge tone="danger">danger</Badge>
        </div>
      </Section>

      <Section title="Menu">
        <Menu
          trigger={<Button variant="secondary">Clip actions ▾</Button>}
          items={[
            { id: "dup", label: "Duplicate", hint: "⌘D" },
            { id: "repeat", label: "Repeat on every chorus" },
            { id: "dis", label: "Unavailable here", disabled: true },
            { id: "del", label: "Delete", hint: "⌫", danger: true },
          ]}
          onPick={(id) => console.log("picked", id)}
        />
      </Section>

      <Section title="Dialog">
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          Open dialog
        </Button>
        <Dialog
          open={dialogOpen}
          title="Designing for"
          onClose={() => setDialogOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>Use this rig</Button>
            </>
          }
        >
          <p className="text-[length:var(--text-sm)] text-ink-dim">
            Pick the venue this show is designed for. The rig it declares is what the
            show is rendered against.
          </p>
        </Dialog>
      </Section>
    </div>
  );
}
