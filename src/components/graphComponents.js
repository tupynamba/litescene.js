/* Requires LiteGraph.js ******************************/

/**
* This component allow to integrate a behaviour graph on any object
* @class GraphComponent
* @param {Object} o object with the serialized info
*/
function GraphComponent(o)
{
	this.enabled = true;
	this.force_redraw = true;

	this.on_event = "update";
	this._graph = new LGraph();

	if(o)
		this.configure(o);
	else //default
	{
		var graphnode = LiteGraph.createNode("scene/node");
		this._graph.add(graphnode);
	}
	
	LEvent.bind(this,"trigger", this.trigger, this );	
}

GraphComponent["@on_event"] = { type:"enum", values: ["start","render","update","trigger"] };

GraphComponent.icon = "mini-icon-graph.png";

/**
* Returns the first component of this container that is of the same class
* @method configure
* @param {Object} o object with the configuration info from a previous serialization
*/
GraphComponent.prototype.configure = function(o)
{
	this.enabled = !!o.enabled;
	if(o.graph_data)
	{
		try
		{
			var obj = JSON.parse(o.graph_data);
			this._graph.configure( obj );
		}
		catch (err)
		{
			console.err("Error parsing Graph data");
		}
	}
}

GraphComponent.prototype.serialize = function()
{
	return { enabled: this.enabled, force_redraw: this.force_redraw , graph_data: JSON.stringify( this._graph.serialize() ) };
}

GraphComponent.prototype.onAddedToNode = function(node)
{
	this._graph._scenenode = node;

	LEvent.bind(node,"start", this.onEvent, this );
	LEvent.bind(node,"beforeRenderMainPass", this.onEvent, this );
	LEvent.bind(node,"update", this.onEvent, this );
}

GraphComponent.prototype.onRemovedFromNode = function(node)
{
	LEvent.unbind(node,"start", this.onEvent, this );
	LEvent.unbind(node,"beforeRenderMainPass", this.onEvent, this );
	LEvent.unbind(node,"update", this.onEvent, this );
}


GraphComponent.prototype.onEvent = function(event_type, event_data)
{
	if(event_type == "beforeRenderMainPass")
		event_type = "render";

	if(this.on_event == event_type)
		this.runGraph();
}

GraphComponent.prototype.trigger = function(e)
{
	if(this.on_event == "trigger")
		this.runGraph();
}

GraphComponent.prototype.runGraph = function()
{
	if(!this._root._in_tree || !this.enabled) return;
	if(this._graph)
		this._graph.runStep(1);
	if(this.force_redraw)
		LEvent.trigger(this._root._in_tree, "change");
}


LS.registerComponent(GraphComponent);
window.GraphComponent = GraphComponent;



/**
* This component allow to integrate a rendering post FX using a graph
* @class FXGraphComponent
* @param {Object} o object with the serialized info
*/
function FXGraphComponent(o)
{
	this.enabled = true;
	this.use_viewport_size = false;
	this.use_high_precision = false;
	this.use_antialiasing = false;
	this._graph = new LGraph();
	if(o)
	{
		this.configure(o);
	}
	else //default
	{
		this._graph_color_texture_node = LiteGraph.createNode("texture/texture","Color Buffer");
		this._graph_color_texture_node.ignore_remove = true;

		this._graph_depth_texture_node = LiteGraph.createNode("texture/texture","Depth Buffer");
		this._graph_depth_texture_node.ignore_remove = true;
		this._graph_depth_texture_node.pos[1] = 400;

		this._graph.add( this._graph_color_texture_node );
		this._graph.add( this._graph_depth_texture_node );

		this._graph_viewport_node = LiteGraph.createNode("texture/toviewport","Viewport");
		this._graph_viewport_node.pos[0] = 500;
		this._graph.add( this._graph_viewport_node );

		this._graph_color_texture_node.connect(0, this._graph_viewport_node );
	}

	if(FXGraphComponent.high_precision_format == null)
	{
		if(gl.half_float_ext)
			FXGraphComponent.high_precision_format = gl.HALF_FLOAT_OES;
		else if(gl.float_ext)
			FXGraphComponent.high_precision_format = gl.FLOAT;
		else
			FXGraphComponent.high_precision_format = gl.UNSIGNED_BYTE;
	}
}

FXGraphComponent.icon = "mini-icon-graph.png";
FXGraphComponent.buffer_size = [1024,512];

/**
* Returns the first component of this container that is of the same class
* @method configure
* @param {Object} o object with the configuration info from a previous serialization
*/
FXGraphComponent.prototype.configure = function(o)
{
	if(!o.graph_data)
		return;

	this.enabled = !!o.enabled;
	this.use_viewport_size = !!o.use_viewport_size;
	this.use_high_precision = !!o.use_high_precision;
	this.use_antialiasing = !!o.use_antialiasing;

	this._graph.configure( JSON.parse( o.graph_data ) );
	this._graph_color_texture_node = this._graph.findNodesByTitle("Color Buffer")[0];
	this._graph_depth_texture_node = this._graph.findNodesByTitle("Depth Buffer")[0];
	this._graph_viewport_node = this._graph.findNodesByTitle("Viewport")[0];
}

FXGraphComponent.prototype.serialize = function()
{
	return { enabled: this.enabled, use_antialiasing: this.use_antialiasing, use_high_precision: this.use_high_precision, use_viewport_size: this.use_viewport_size, graph_data: JSON.stringify( this._graph.serialize() ) };
}

FXGraphComponent.prototype.getResources = function(res)
{
	var nodes = this._graph.findNodesByType("texture/texture");
	for(var i in nodes)
	{
		if(nodes[i].properties.name)
			res[nodes[i].properties.name] = Texture;
	}
	return res;
}

FXGraphComponent.prototype.onAddedToNode = function(node)
{
	this._graph._scenenode = node;
	LEvent.bind(Scene,"beforeRenderPass", this.onBeforeRender, this );
	LEvent.bind(Scene,"afterRenderPass", this.onAfterRender, this );
}

FXGraphComponent.prototype.onRemovedFromNode = function(node)
{
	LEvent.unbind(Scene,"beforeRenderPass", this.onBeforeRender, this );
	LEvent.unbind(Scene,"afterRenderPass", this.onAfterRender, this );
	Renderer.color_rendertarget = null;
	Renderer.depth_rendertarget = null;
}

FXGraphComponent.prototype.onBeforeRender = function(e, render_options)
{
	if(!this._graph || !render_options.render_fx) return;

	var use_depth = false;
	if(this._graph_depth_texture_node && this._graph_depth_texture_node.isOutputConnected(0))
		use_depth = true;

	var width = FXGraphComponent.buffer_size[0];
	var height = FXGraphComponent.buffer_size[1];
	if( this.use_viewport_size )
	{
		width = gl.canvas.width;
		height = gl.canvas.height;
		//var v = gl.getParameter(gl.VIEWPORT);
		//width = v[2];
		//height = v[3];
	}

	var type = this.use_high_precision ? FXGraphComponent.high_precision_format : gl.UNSIGNED_BYTE;

	if(!this.color_texture || this.color_texture.width != width || this.color_texture.height != height || this.color_texture.type != type)
	{
		this.color_texture = new GL.Texture(width,height,{ format: gl.RGB, filter: gl.LINEAR, type: type });
		ResourcesManager.textures[":color_buffer"] = this.color_texture;
	}

	if((!this.depth_texture || this.depth_texture.width != width || this.depth_texture.height != height) && use_depth)
	{
		this.depth_texture = new GL.Texture(width, height, { filter: gl.NEAREST, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT });
		ResourcesManager.textures[":depth_buffer"] = this.depth_texture;
	}		

	if(this.enabled)
	{
		Renderer.color_rendertarget = this.color_texture;
		if(use_depth)
			Renderer.depth_rendertarget = this.depth_texture;
		else
			Renderer.depth_rendertarget = null;
	}
	else
	{
		Renderer.color_rendertarget = null;
		Renderer.depth_rendertarget = null;
	}
}


FXGraphComponent.prototype.onAfterRender = function(e,render_options)
{
	if(!this._graph || !this.enabled || !render_options.render_fx) return;

	if(!this._graph_color_texture_node)
		this._graph_color_texture_node = this._graph.findNodesByTitle("Color Buffer")[0];
	if(!this._depth_depth_texture_node)
		this._depth_depth_texture_node = this._graph.findNodesByTitle("Depth Buffer")[0];

	if(!this._graph_color_texture_node)
		return;

	this._graph_color_texture_node.properties.name = ":color_buffer";
	if(this._graph_depth_texture_node)
		this._graph_depth_texture_node.properties.name = ":depth_buffer";
	if(this._graph_viewport_node) //force antialiasing
		this._graph_viewport_node.properties.antialiasing = this.use_antialiasing;

	this._graph.runStep(1);
}


LS.registerComponent(FXGraphComponent);
window.FXGraphComponent = FXGraphComponent;







