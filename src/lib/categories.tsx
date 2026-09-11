import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import * as backend from "./backend";
import type { MailCategory } from "./backend";
import { useT } from "./i18n";

/**
 * The categories mail is sorted into, shared by the list, the reader and Settings.
 *
 * They live in the database rather than in code because they are the user's: the six
 * seeded ones can be renamed or removed, and new ones can be added at any time. Every
 * command returns the whole list, so there is one round trip per change and no chance of
 * the interface holding a stale copy.
 */
export interface Categories {
  all: MailCategory[];
  /** The display name for a slug: translated for built-ins, as typed for the rest. */
  nameOf: (slug: string) => string;
  /**
   * The description to show.
   *
   * A built-in you have not reworded is shown in the app's language while the assistant
   * keeps reading the English: sorting was measured with Swedish descriptions and the model
   * started reasoning instead of answering, losing 6 of 14. Reword one and your words are
   * both what you see and what it reads.
   */
  describe: (category: MailCategory) => string;
  reload: () => Promise<void>;
  create: (name: string, description: string, autoSort: boolean) => Promise<void>;
  update: (slug: string, name: string, description: string, autoSort: boolean) => Promise<void>;
  remove: (slug: string) => Promise<void>;
  /** Put messages in a category by hand, or clear it with null. */
  assign: (messageIds: string[], slug: string | null) => Promise<void>;
  /** The last error from any of the above, for showing next to the form. */
  error: string | null;
}

const CategoriesContext = createContext<Categories | null>(null);

export function useCategories(): Categories {
  const value = useContext(CategoriesContext);
  if (!value) throw new Error("useCategories outside CategoriesProvider");
  return value;
}

export function CategoriesProvider({
  children,
  onChanged,
}: {
  children: ReactNode;
  /** Called after anything that can change what a message is sorted as. */
  onChanged?: () => Promise<unknown>;
}) {
  const [all, setAll] = useState<MailCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const reload = useCallback(async () => {
    setAll(await backend.listCategories());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Every mutation returns the new list, so this both applies the change and refreshes.
  const run = useCallback(
    async (work: () => Promise<MailCategory[]>, touchesMail: boolean) => {
      setError(null);
      try {
        setAll(await work());
        if (touchesMail) await onChanged?.();
      } catch (e) {
        setError(String(e));
      }
    },
    [onChanged],
  );

  const value: Categories = {
    all,
    describe: (category) =>
      category.isBuiltin && !category.edited
        ? t.category.description[category.slug] ?? category.description
        : category.description,
    nameOf: (slug) => {
      const known = t.category.name[slug];
      if (known) return known;
      return all.find((c) => c.slug === slug)?.name ?? slug;
    },
    reload,
    create: (name, description, autoSort) =>
      run(() => backend.createCategory(name, description, autoSort), false),
    update: (slug, name, description, autoSort) =>
      run(() => backend.updateCategory(slug, name, description, autoSort), false),
    // Deleting un-sorts everything that was in it, so the mail list has to be reloaded.
    remove: (slug) => run(() => backend.deleteCategory(slug), true),
    assign: async (messageIds, slug) => {
      setError(null);
      try {
        await backend.setMessageCategory(messageIds, slug);
        await onChanged?.();
      } catch (e) {
        setError(String(e));
      }
    },
    error,
  };

  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>;
}
