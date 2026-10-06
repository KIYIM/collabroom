# CollabRoom

A real-time collaborative code editor and execution sandbox built with Next.js, TypeScript, and Server-Sent Events.

**Live Demo:** [collabroom-one.vercel.app](https://collabroom-one.vercel.app)

---

## Features

- **Real-Time State Synchronization:** Simultaneous multi-client editing across isolated rooms via Server-Sent Events (SSE) and `BroadcastChannel`.
- **Peer Presence & Cursors:** Dynamic remote cursor tracking displaying real-time peer positions and user avatar tags.
- **Multi-Language Remote Code Runner:** Asynchronous backend execution pipeline (`/api/run`) evaluating Python, JavaScript, and C++ with strict server-side timeouts and runtime performance metrics.
- **Virtual Workspace:** In-browser file explorer supporting multi-file buffer switching, automatic syntax detection, local storage persistence, and single-file downloads.
- **Modern Developer UI:** Responsive dark-themed workspace built with Tailwind CSS and Radix UI primitives.

---

## Tech Stack

- **Framework:** Next.js (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS, Lucide Icons
- **Real-Time Layer:** Server-Sent Events (SSE), Web BroadcastChannel API
- **Deployment:** Vercel

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone [https://github.com/KIYIM/collabroom.git](https://github.com/KIYIM/collabroom.git)
   cd collabroom
