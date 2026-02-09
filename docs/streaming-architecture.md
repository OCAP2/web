# Streaming Architecture

This document describes the playback and conversion flows for large recording support.

## Playback Flow

```mermaid
flowchart TD
    A[User selects recording] --> B{Check storageFormat}

    B -->|protobuf| C[Streaming Mode]
    B -->|json or empty| D[Legacy Mode]

    subgraph Legacy[Legacy Mode - small recordings]
        D --> D1[Download entire JSON.gz]
        D1 --> D2[Decompress in browser]
        D2 --> D3[Load all data into memory]
        D3 --> D4[Start playback]
    end

    subgraph Streaming[Streaming Mode - large recordings]
        C --> C1[Fetch manifest]
        C1 --> C2[Initialize entities from manifest]
        C2 --> C3[Start playback]
        C3 --> C4{Need chunk for current frame?}
        C4 -->|Chunk in memory| C5[Use cached chunk]
        C4 -->|Chunk not loaded| C6{Check browser cache}
        C6 -->|Cache hit| C7[Load from OPFS/IndexedDB]
        C6 -->|Cache miss| C8[Fetch chunk from server]
        C8 --> C9[Cache in browser storage]
        C7 --> C10[Decode chunk]
        C9 --> C10
        C10 --> C11[Store in memory LRU cache]
        C11 --> C5
        C5 --> C12[Update entity positions]
        C12 --> C13{Playback continues?}
        C13 -->|Yes| C4
        C13 -->|No| C14[End]
    end

    D4 --> E[Playback running]
    C14 --> E
```

## Conversion Flow

```mermaid
flowchart TD
    A[New JSON.gz uploaded] --> B[Stored in database]
    B --> C{Conversion enabled?}

    C -->|No| D[Stays as JSON]
    D --> E[Legacy playback only]

    C -->|Yes| F[Mark as pending]
    F --> G[Background worker picks up]

    subgraph Conversion[Conversion Process]
        G --> H[Read JSON.gz]
        H --> I[Parse entities and frames]
        I --> J[Split into chunks]
        J --> L[Encode as .pb files]
        L --> N[Write manifest + chunks]
    end

    N --> O[Update database]
    O --> P[storageFormat = protobuf]
    P --> Q[Streaming playback available]

    subgraph Manual[Manual Conversion via CLI]
        R[convert --input file.gz] --> H
        S[convert --all] --> G
    end
```

## Browser Caching

The browser uses a two-tier caching system:

1. **Memory Cache (LRU)**: Up to 3 chunks kept in RAM for instant access
2. **Persistent Cache (OPFS/IndexedDB)**: Chunks saved to browser storage for future sessions

This allows:
- Smooth playback without re-downloading chunks
- Seeking to previously viewed sections instantly
- Reduced server load on repeat viewings
