/**
 * Параметр демки, живущий в адресе страницы.
 *
 * Зачем в адресе, а не в локальном состоянии: смена значения после гидратации
 * лишь меняет `src` у существующих `<img>`, а браузер держит на экране прежнюю
 * картинку, пока грузится новая. Настоящий первый пейнт виден только при загрузке
 * страницы, у которой параметр уже учтён на сервере. Плюс ссылкой можно поделиться.
 *
 * Возвращает ЗАПИСЫВАЕМЫЙ computed, чтобы работал `v-model`: привязка `:value`
 * к `<select>` во Vue не выбирает опцию, и контрол показывает не то, что применено.
 */
export function useQueryParam<T extends string | number>(key: string, fallback: T) {
  const route = useRoute();
  const router = useRouter();
  const numeric = typeof fallback === 'number';

  return computed<T>({
    get() {
      const raw = route.query[key];
      if (raw === undefined || raw === null || raw === '') return fallback;
      if (!numeric) return String(raw) as T;
      const parsed = Number.parseInt(String(raw), 10);
      return (Number.isFinite(parsed) ? parsed : fallback) as T;
    },
    set(value) {
      router.push({ query: { ...route.query, [key]: String(value) } });
    },
  });
}
