Прочитай:

- AGENTS.md
- SPEC.md
- все тикеты в .scratch/live-client-map/issues/

Работай только с тикетами начиная с 09.

Твоя задача — автономно выполнять тикеты по порядку.

Правила:

1. Найди первый тикет с номером >= 09, у которого:
   - Status не resolved
   - все тикеты из Blocked by имеют Status resolved

2. Работай только над этим одним тикетом.

3. Перед началом:
   - прочитай полный текст тикета;
   - прочитай связанные Blocked by тикеты;
   - изучи существующий код.

4. После начала:
   - измени Status на claimed.

5. Реализуй все acceptance criteria тикета.

6. Выполни:
   - lint
   - typecheck
   - необходимые тесты

7. После успешной проверки:
   - измени Status на resolved;
   - добавь раздел:
     ## Implementation result

   В нём укажи:
   - что сделано;
   - какие файлы изменены;
   - какие проверки пройдены.

8. После завершения автоматически переходи к следующему тикету.

9. Если встретил:
   - неоднозначность в SPEC.md;
   - архитектурный выбор, которого нет в решённых тикетах;
   - невозможность продолжить;

   тогда:
   - поставь Status: needs-info;
   - запиши конкретный вопрос;
   - остановись.

Не переходи через нерешённые блокеры.
Не меняй архитектуру без основания.
Не делай несколько тикетов одновременно.

Продолжай, пока не закончишь все доступные тикеты или не встретишь needs-info.

## Safety rules

Never run destructive commands without explicit approval:

- rm -rf
- git reset --hard
- git clean
- git push
- database destructive migrations
- deleting project files

## Ticket assignment priority

If user explicitly assigns a ticket number:
- work only on that ticket;
- do not switch to another ticket automatically;
- if blocked, stop and explain blockers.

Automatic ticket ordering applies only when no ticket number was explicitly assigned.

If multiple agents are working:

Do not assume all previous ticket numbers are available.

Before taking a ticket:
- check Status;
- check Blocked by;
- check if another agent already modified related files.

Never take a ticket assigned to another agent.