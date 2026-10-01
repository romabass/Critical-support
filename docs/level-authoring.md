# Авторинг уровня

Уровень — JSON-файл в `src/levels/` плюс строка в реестре `LEVELS` (`src/levels/LevelManager.ts`). Данные валидируются функцией `validateLevel` до создания физики, поэтому опечатка в id или ссылка на несуществующий элемент падает сразу, а не посреди симуляции.

## Регистрация

```ts
export const LEVELS: readonly LevelEntry[] = [
  {
    id: 'water_tower_01',
    title: 'Старая водонапорная башня',
    file: 'water_tower_01.json',
    maxShots: 3,
  },
];
```

## Каркас файла

```jsonc
{
  "id": "water_tower_01",
  "title": "Старая водонапорная башня",
  "briefing": ["Короткие подсказки для игрока"],
  "maxShots": 3,
  "parShots": 2, // необязательно, влияет на счёт
  "projectileId": "concrete_impact_ball",
  "launcher": {
    "x": -0.6,
    "y": 2.4,
    "minAngleDeg": -12,
    "maxAngleDeg": 82,
    "defaultAngleDeg": 41,
    "minPower": 0.15,
    "maxPower": 1,
  },
  "environment": {
    "groundY": 0,
    "leftBound": -12,
    "rightBound": 44,
    "ceilingY": 26,
    "killY": -12,
    "gravity": 18,
  },
  "camera": { "centerX": 14, "centerY": 8, "zoom": 1 },
  "largeDebrisMass": 40, // порог «крупного» обломка для красной зоны
  "criticalObjects": ["generator_01"],
  "elements": [],
  "connections": [],
  "zones": [],
  "objectives": [],
}
```

Мир: `y` растёт вверх, `groundY` — линия земли, `killY` — ниже которой элемент удаляется. Всё, что ниже `killY` или выше `ceilingY` (кроме `role: "ground"`), валидатор отклоняет.

## Элементы

```json
{
  "id": "column_b_lower",
  "material": "concrete",
  "shape": "box", // box | circle | polygon
  "x": 8.2,
  "y": 5.6,
  "width": 0.9,
  "height": 7.2,
  "role": "structure", // ground | structure | projectile_blocker
  "anchored": true,
  "group": "upper_tower", // группа для цели destroy_group
  "label": "Нижняя секция колонны B",
  "health": 120 // необязательное переопределение прочности
}
```

Ключевые поля:

- `group` — элементы с одинаковой группой считаются разрушенными вместе; группа должна существовать, иначе цель не выполнима;
- `anchored` — элемент закреплён и не падает сам;
- `health` — переопределяет прочность материала для конкретного элемента, удобно для точечной настройки баланса;
- `material: "generator"` и `"ground"` не разрушаются, но накапливают урон.

## Связи

```json
{
  "id": "c_col_b_1",
  "a": "column_b_lower",
  "b": "column_b_upper",
  "kind": "weld",
  "strength": 1800
}
```

`kind: "weld"` создаёт жёсткий джойнт, `kind: "breakable"` — связь, которая рвётся при превышении `strength`. Самоссылающиеся связи запрещены.

## Зоны

```json
{
  "id": "red_zone",
  "kind": "red",
  "x": 8.5,
  "y": 5.5,
  "width": 15,
  "height": 11,
  "label": "Запретная зона",
  "maximumDebrisMass": 320
}
```

Красная зона обязана иметь положительный `maximumDebrisMass`, зелёная — неотрицательный `targetDebrisMass`. Масса считается только по элементам с массой не меньше `largeDebrisMass`.

## Цели

```json
{
  "type": "destroy_group",
  "group": "upper_tower",
  "minimumPercent": 80,
  "label": "Обрушить верхнюю часть башни",
  "weight": 0.5
}
```

Поддерживаются `destroy_group`, `protect_object` и `zone_debris_limit`. `protect_object` ссылается на `objectId`, `zone_debris_limit` — на `zoneId`. `weight` задаёт вклад в общий прогресс целей.

## Проверка баланса

После правки уровня обязателен эталонный прогон:

```bash
npm run playthrough
```

Скрипт стреляет заданным планом, печатает отчёт и завершается с ненулевым кодом, если победить не удалось. Тот же план зафиксирован в `tests/integration/playthrough.test.ts`, поэтому непроходимый уровень ломает `npm test`, а не обнаруживается вручную. Отчёт пишется в `artifacts/playthrough.json` (каталог в `.gitignore`).
