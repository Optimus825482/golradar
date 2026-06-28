# Idea Tree

**Baseline**: 34 | **Trunk**: N/A

## ROOT: GolRadar2 M1 (gol tespit) ve M2 (taraf doğruluğu) metriklerini iyileştir. Baseline: M1=%34.1, M2=%67.5 (28 Haziran). Hedef: M1>%50, M2>%75. [DONE]

### 1: H1: Cooling karesel + golden sonra 3dk yasak (commit 22f2f0c) ||  goto :error [PRUNED]

**Insight**: [Pruned: format fix]

### 2: Mechanism: Golden sonra cooling yetersizdi (linear decay, 0.6 çarpan). Hücum patlaması faktörü golden sonra anlık spike yapıp false alarm üretiyordu. ||  goto :error [PRUNED]

**Insight**: [Pruned: format]

### 3: Mechanism: Golden sonra cooling linear (0.6 çarpan) yetersizdi. Hücum patlaması faktörü golden sonra anlık spike ile skoru eşik üstüne taşıyıp false alarm üretiyordu. ||  goto :error [PRUNED]

**Insight**: [Pruned: format]

### 4: Mechanism: Cooling linear 0.6 yetersiz, gol sonrası hücum patlaması false alarm üretiyordu. ||  goto :error [PENDING]

### 5: Mechanism: 28 Haziranda 276 sinyalin 129'u 60-64 bandindaydi ve bunlarin M1=27.9. Esik 60 cok dusuk. ||  goto :error [PENDING]
