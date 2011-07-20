"use strict";

//This module implements basic topological operations for cell complexes

//It will support things like:
//	+ adding cells
//	+ removing cells
//	+ subdividing cells
//	+ collapsing cells
//	+ support for hooks to other library components
//
//It will not support things like:
//  - set operations
//  - data format interoperability
//  - etc. 
//

//Default vertex buffer capacity for the mesh
var DEFAULT_CAPACITY = 1024;

//Bounding box record
function BoundingBox(lo, hi) {
    this.lo = lo;
    this.hi = hi;
}

//Incidence record
function IncidenceRec(vert, cell) {
    this.vert = vert;
    this.cell = cell;
}

//A cell label
function Cell(d, c) {
	this.dimension = d;
	this.cell_id = c;
}

//A cell data record
function CellRec() {
    this.boundary = [];
    this.coboundary = [];
}

//Special case of cell record, vertices have no boundary but instead have an index into
//vertex table storing their attributes
function VertexRec(v) {
    this.v = v;
    this.coboundary = [];
}

//Initializes the cell-tuple complex
// d = dimension of graph (must be nonnegative)
// vfmt = The vertex format
function CellTupleComplex(d, vfmt, position_attribute) {

	//Initialize topological data
    var i;
    this.cells = new Array(d+1);
    this.names = new Array(d+1);
    this.count = new Array(d+1);
    
    for(i=0; i<=d; ++i) {
        this.cells[i] = {};
        this.names[i] = 0;
        this.count[i] = 0;
    }

   	//Initialize vertex buffer data
   	if(!(vfmt instanceof VertexFormat)) {
   		Console.log("Warning!  Invalid vertex format!");
   	}
   	
   	//Check that position attribute is ok
   	if(!(position_attribute in VertexFormat)) {
   	    Console.log("Warning! Invalid position attribute!");
   	}
   	
   	this.vertex_format = vfmt;
   	this.vsize = vfmt.vsize;
    this.vbuffer = new Float32Array(DEFAULT_CAPACITY * this.vsize);
    this.vlookup = [];
    
    //Extract position attribute data
    this.position_attribute = position_attribute
    this.position_offset = vfmt[position_attribute].attr_offset;
    this.position_size = vfmt[position_attribute].attr_size;
    
    //Spatial index (by default null)
    this.spatial_index = null;
}

//Creates a cell-tuple complex from a minimal set of json data
function ctcomplex_from_json(data) = {
    //Extract vertex format
    var vfmt = new VertexFormat(), i;
    for(i=0; i<data.vfmt.length; ++i) {
        vfmt.add_attribute(data.vfmt[i]);
    }
    
    var ctcomplex = new CellTupleComplex(data.cells.length)
}

//Converts a cell-tuple complex to json for interprocess serialization
// This avoids accidentally serializing any data structure dependencies and fixes
// the problem with the float32arrays not being serializable.
CellTupleComplex.prototype.to_json = function() {
    var data = {};
    
    data.vfmt = this.vertex_format.attributes;
    data.pattr = this.position_attribute;
    data.vbuf = new Array(this.vbuffer.subarray(0, this.count[0] * this.vsize);
    data.cells = new Array(this.cells.length);
    
    var i, j, k, c, bnd;
    for(i=0; i<this.cells.length; ++i) {
        k = -1;
        data.cells[i] = new Array(this.count[i]);
        for(c in this.cells[i]) {
            data.cells[i][++k] = new Array(i+1);
            bnd = this.cells[i][c];
            for(j=0; j<b.length; ++j) {
                data.cells[i][k][j] = bnd[j].vert;
            }
        }
    }
    
    return data;
}

//Looks up the id for a given cell from its vertex tuple
// tup is the list of vertex names for the cell
// Returns the name of the cell (if it exists) or else -1
CellTupleComplex.prototype.lookup_cell = function(tup) {
	if(!(tup[0] in this.cells[0]))
		return null;

    if(tup.length == 1)
        return new Cell(0, tup[0]);

    var v, i, j, cob, c = tup[0], d = tup.length-1;
    
    for(i=0; i<d; ++i) {
        v = this.cells[i][c];
    
        for(j=0; j<v.coboundary.length; ++j) {
            cob = v.coboundary[j];
            if(cob.vert == tup[i+1])
            {
                c = cob.cell;
                break;
            }
        }
        
        if(j == v.coboundary.length) {
            return null;
        }
    }

    return new Cell(d, c);
}

//Looks up the tuple for a given cell
// d is the dimension of the cell
// c is the name of the cell
// Returns the tuple of the cell, or an empty list if no such cell exists
CellTupleComplex.prototype.get_tuple = function(cel) {
	var c = cel.cell_id, d = cel.dimension;
    if(!(c in this.cells[d]))
        return [];
    if(d < 1)
        return [ c ];
    
    var i, boundary = this.cells[d][c].boundary, res = new Array(d+1);
    for(i=0; i<=d; ++i) {
        res[i] = boundary[i].vert;
    }
    return res;
}

//Retrieves the vertex data from a vertex object
// vert is a cell label for the vertex
// Returns the components of the vertex, as arranged by the vertex format
CellTupleComplex.prototype.get_vert_data = function(vert) {
	var c = vert.cell_id, d = vert.dimension;
	if( d != 0  || !(c in this.cells[0]) )
		return []
	
	var off = this.cells[0][c].v * this.vsize;
	return this.vbuffer.slice(off, off+this.vsize);
}

//Adds a vertex to the graph
// vdata is the vertex data
// Returns the name of the vertex
CellTupleComplex.prototype.add_vert = function(vdata) {
    var c = this.names[0]++;
    
    //Check if we need to resize vertex array
    var off = this.count[0] * this.vsize;
    if(off >= this.vbuffer.length) {
    	var tmp = this.vbuffer;
    	this.vbuffer = new Float32Array(this.vbuffer.length * 2);
    	this.vbuffer.set(tmp);
    }
    
    //Set data
    this.vbuffer.subarray(off, off+this.vsize).set(vdata);
    this.vlookup.push(c);
    
    this.cells[0][c] = new VertexRec(this.count[0]++);
    
    //Update spatial index
    if(this.spatial_index) {
    	this.spatial_index.add_cell( [c], new Cell(0, c) );
    }
    
    return c;
}

//Adds a cell to the graph
// tup is a list of vertex indices
// Returns name of cell or -1 if the vertices of the cell do not exist
CellTupleComplex.prototype.add_cell = function(tup) {
    //Check all verts exist
    var i, d = tup.length-1;
    for(i=0; i<tup.length; ++i) {
        if(!(tup[i] in this.cells[0]))
            return null;
    }

    //Check if cell already exists
    var o = this.lookup_cell(tup);
    if(o)
    	return o;
    
    //Update all bounding cells
    var b, nc = new CellRec(), v, c = this.names[d]++; 
    for(i=0; i<tup.length; ++i) {
    	//Add boundary cell (if needed)
        v = tup[i];
        tup[i] = tup[d];
        b = this.add_cell(tup.slice(0, d)).cell_id;
        tup[i] = v;
        
        //Add to boundary of this cell, and update coboundary relation
        nc.boundary.push( new IncidenceRec(v, b) );
        this.cells[d-1][b].coboundary.push(new IncidenceRec(v, c));
    }
    
    //Add cell
    var cel = new Cell(d, c);
    this.cells[d][c] = nc;
    this.count[d]++;
    
    //Add cell to spatial index
    if(this.spatial_index) {
    	this.spatial_index.add_cell(tup, cel);
    }
    
    return cel;
}

//Removes a cell from the graph
// d is the dimension of the cell
// c is the name of the cell
CellTupleComplex.prototype.remove_cell = function(cel) {
    //Verify cell exists
	var d = cel.dimension, c = cel.cell_id;
    if(!(c in this.cells[d]))
        return;

	//Remove from spatial index
	if(this.spatial_index) {
		this.spatial_index.remove_cell(cel);
	}

    //Remove from boundary of all lower cells
    var i, j, t, b;
    if(d > 0) {
        var boundary = this.cells[d][c].boundary;
        for(i=0; i<boundary.length; ++i) {
            b = this.cells[d-1][boundary[i].cell];
            for(j=0; j<b.coboundary.length; ++j) {
                if(b.coboundary[j].cell == c) {
                    b.coboundary[j] = b.coboundary[b.coboundary.length-1];
                    b.coboundary.pop();
                    break;
                }
            }
        }
    }
    else {
    	//Calculate offsets
    	var v = this.cells[0][c].v,
    		off = v * this.vsize,
    		eoff = this.count[0] * this.vsize;

		//Fix vertex index lookup
		i = this.vlookup[this.count[0]-1];
		this.cells[0][i].v = v;
		this.vlookup[v] = i;
		this.vlookup.pop();
		
		//Erase from vertex array
    	this.vbuffer.subarray(off, off+this.vsize).set(this.vbuffer.subarray(eoff - this.vsize, eoff));
    }

    //Delete all cells on coboundary
    var coboundary = this.cells[d][c].coboundary;
    while(coboundary.length > 0) {
        this.remove_cell(new Cell(d+1, coboundary[0].cell));
    }

    //Delete cell
    delete this.cells[d][c];
    this.count[d]--;
}

//Subdivides a cell
// d is the dimension
// c is the cell name
// v is the vertex which is getting added to split the cell
CellTupleComplex.prototype.split_cell = function(cel, v) {
	var d = cel.dimension, c = cel.cell_id;

	//Make sure cell exists
	if(!(c in this.cells[d]) || !(v in this.cells[0]) || this.cells[0][v].coboundary.length > 0)
		return;
	
	//Split the cell
	var bnd = this.get_tuple(cel), i, t;
	for(i=0; i<bnd.length; ++i) {
		t = bnd[i];
		bnd[i] = v;
		this.add_cell(bnd);
		bnd[i] = t;
	}
	
	//Split coboundary
	var nc = this.cells[d][c];
	for(i=0; i<nc.coboundary.length; ++i) {
		this.split_cell(d+1, nc.coboundary[i].cell, v);
	}
	
	//Remove the cell
	this.remove_cell(d,c);
}

//Collapses a cell down to a single vertex
// d is the dimension
// c is the cell name
// v is the vertex it will be collapsed down to
CellTupleComplex.prototype.collapse_cell = function(cel, v) {
	//Check that cell and vertex exist
	var d = cel.dimension, c = cel.cell_id;
	if(!(c in this.cells[d]) || !(v in this.cells[0]) || this.cells[0][v].coboundary.length > 0)
		return;

	//Replace all of the counbary cells with reduced dimension cells
	var bnd = this.get_tuple(cel), i, j, cob = this.cells[d][c].coboundary, to_visit = [], t;
	
	//Add all the collapsed cells to visit list
	for(i=0; i<cob.length; ++i) {
		this.add_cell([v, cob[i].vert]);
		to_visit.push([ [v, cob[i].vert], cob[i].cell ]);
	}
	
	//Collapse all cobordant cells
	for(i=0; i<to_visit.length; ++i) {
		cob = this.cells[d + to_visit[i][0].length - 1][to_visit[i][1]].coboundary;
		
		for(j=0; j<cob.length; ++j) {
			t = to_visit[i][0].slice();
			t.push(cob[j].vert);
			this.add_cell( t )
			to_visit.push([ t, cob[j].cell ]);
		}
	}
	
	//Remove all boundary cells
	for(i=0; i<bnd.length; ++i) {
		this.remove_cell(new Cell(0, bnd[i]));
	}
}

//Retrieves vertex buffer data
CellTupleComplex.prototype.get_vert_buffer = function() {
	return this.vbuffer.subarray(0, this.count[0]*this.vsize);
}

//Retrieves index buffer data for cells of dimension d
CellTupleComplex.prototype.get_index_buffer = function(d, surface_only) {
	var ib = new Uint16Array((d+1) * this.count[d]), i=0, j, v, c, n = 0;
	
	if(d > 0) {
		if(surface_only) {
			for(c in this.cells[d]) {
				if(this.cells[d][c].coboundary.length <= 1) {
					for(j=0; j<=d; ++j) {
						v = this.cells[d][c].boundary[j].vert;
						ib[i++] = this.cells[0][v].v;
					}
					++n;
				}
			}		
		}
		else {
			for(c in this.cells[d]) {
				for(j=0; j<=d; ++j) {
					v = this.cells[d][c].boundary[j].vert;
					ib[i++] = this.cells[0][v].v;
				}
				++n;
			}
		}
	}
	else {
		for(c in this.cells[0]) {
			ib[i++] = this.cells[0][c].v;
			++n;
		}
	}
	
	return ib.subarray(0, i);
}


//Attaches a spatial index to the cell tuple complex
// This is useful for doing boolean operations, range queries etc.
CellTupleComplex.prototype.attach_spatial_index = function(spatial_index) {
	if(this.spatial_index) {
		this.spatial_index.detach_cellcomplex();
	}
	
	this.spatial_index = spatial_index;
	this.spatial_index.attach_complex(this);
	
	var d, c, cel;
	for(d=0; d<this.cells.length; ++d) {
		for(c in this.cells[d]) {
			cel = new Cell(d, c);
			this.spatial_index.add_cell(this.get_tuple(cel), cel);
		}
	}
}

//Locates a point in the cell complex
CellTupleComplex.prototype.locate_point = function(coord) {
    if(this.spatial_index) {
        return this.spatial_index.locate_point(coord);
    }
    
    //Default to crappy linear search if no spatial index is available
    var d, c, cel;
    for(d=0; d<this.cells.length; ++d) {
        for(c in this.cells[d]) {
            cel = new Cell(d, c);
            if(this.point_in_cell(coord, cel))
                return cel;
        }
    }
    return null;
}

//Retrieves the coordinates for a cell
CellTupleComplex.prototype.get_coordinates = function(cel) {
    var tup = this.get_tuple(cel), i, res = [], v;
    if( tup.length == 0 )
        return [];
    for(i=0; i<tup.length; ++i) {
        v = this.get_vert_data(tup[i]);
        res.push(v.slice(this.position_offset, this.position_offset + this.position_size));
    }
    return res;
}

//Checks if a point is in the given cell
CellTupleComplex.prototype.point_in_cell = function(coord, cel) {
    var coords = this.get_coordinates(cel);
    if(coords.length == 0)
        return false;

    //TODO: Implement simplex PMC here

    return false;
}

//Returns the bounding box for a cell
CellTupleComplex.prototype.cell_bounds = function(cel) {
    var coords = this.get_coordinates(cel);
    if(coords.length == 0)
        return [];   
    var lo = coords[0].slice(0,-1), hi = coords[0].slice(0,-1), i, j;
    for(i=1; i<coords.length; ++i) {
        for(j=this.position_size-1; j>=0; --j) {
            lo[j] = Math.min(lo[j], coords[i][j]);
            hi[j] = Math.max(hi[j], coords[i][j]);
        }
    }
    return new BoundingBox(lo, hi);
}

