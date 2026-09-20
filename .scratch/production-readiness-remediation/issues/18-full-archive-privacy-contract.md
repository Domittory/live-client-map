# 18: Собрать полный privacy-safe archive contract

**What to build:** Создать единый contract-compliant assembler для полного Client archive и перепроверить CSV/report/supervision projections, чтобы каждый экспорт имел стабильную схему и применял visibility и relationship privacy до сериализации.

**Blocked by:** 04/Сделать Organization, Client, access и consent мутации атомарными.

**Status:** ready-for-agent

- [ ] Full JSON archive всегда содержит все обязательные collections; отсутствующие collections представлены пустыми значениями требуемого типа.
- [ ] Manifest counts, contract version, referenced catalog, warnings и canonical data hash точно соответствуют сериализованным данным.
- [ ] Silent truncation и dangling references запрещены и приводят к явной failure/warning согласно contract.
- [ ] Relationship data включается только при двухстороннем consent и допустимом access без private evidence второго Client.
- [ ] Supervisor получает только allowlisted anonymized projection при active assignment и обоих обязательных consents.
- [ ] Contract tests покрывают empty collections, privacy filtering, deterministic ordering и отсутствие identifiers/raw content в filenames и logs.
