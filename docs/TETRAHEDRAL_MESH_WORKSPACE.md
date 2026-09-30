# Whole-board tetrahedral meshes

Open **Mesh → Explicit tetra mesh** to prepare and inspect tetrahedral meshes.

1. Import `examples/pcb_focus_mesh/whole_board.json` from the source checkout.
2. Choose SI, EM or thermal use. This records intent; it does not attach the mesh to a solver.
3. Select nets, source traces or vias. Set fine size, coarse background size and halo in millimetres. Add manual regions when needed.
4. Click **Prepare whole-board mesh** and review retained solids and focus regions.
5. Click **Generate prepared mesh**. Gmsh must be installed in the supported runtime configuration.
6. Review cell counts, minimum quality, volume coverage, source ownership and sizing feedback. Export the request and result for a compatible solver adapter.

Selection changes sizing. The rest of the declared board remains present.

This experimental path imports a normalized planar volume model. It does not automatically convert KiCad files, mesh bent rigid-flex geometry, or establish solver accuracy. Explicit prism and tube requests and saved v1/v2 mesh results can also be imported.

See [supported geometry and limits](PCB_FOCUSED_VOLUME_MESHING.md) and [internal meshing](INTERNAL_MESH_ENGINE.md).
