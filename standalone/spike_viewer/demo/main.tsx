// SPDX-License-Identifier: Apache-2.0
import { createRoot } from "react-dom/client";
import Lab from "./Lab";
import AssemblyLab from "./AssemblyLab";
createRoot(document.getElementById("root")!).render(new URLSearchParams(location.search).get("lab")==="virtual" ? <Lab/> : <AssemblyLab/>);
