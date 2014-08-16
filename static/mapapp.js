// Uses local storage to persist models within your browser.
// This will be uncoupled and connected to the server to persist models in the database
// Load the application once the DOM is ready, using `jQuery.ready`:
$(function () {

    // MapPoint Model `title`, `order`, and `done` attributes.
    // --------------
    var MapPoint = Backbone.Model.extend({

        // Default attributes for the mappoint item.
        defaults: function () {
            return {
		// title refers to the location of the point
                title: "display point...",
                order: MapPoints.nextOrder(),
		// description and type are attributes of the first point.
		description: "Type description here.",
		type: "point",
                done: false
            };
        },

        // Ensure that each mappoint created has `title`.
        initialize: function () {
            if (!this.get("title")) {
                this.set({
                    "title": this.defaults().title
                });
            }
        },

        // Toggle the `done` state of this mappoint item.
        toggle: function () {
            this.save({
                done: !this.get("done")
            });
        }

    });

    // MapPoints Collection is backed by *localStorage* instead of a remote server.
    // --------------
    
    var MapPointList = Backbone.Collection.extend({

        // Reference to this collection's model.
        model: MapPoint,

        // Save all of the MapPoint items under the mappoints-backbone namespace.
        localStorage: new Backbone.LocalStorage("mappoints-backbone"),

        // Filter down the list of all mappoint items that are finished.
        done: function () {
            return this.filter(function (mappoint) {
                return mappoint.get('done');
            });
        },

        // Filter down the list to only mappoint items that are still not finished.
        remaining: function () {
            return this.without.apply(this, this.done());
        },

        // We keep the MapPoints in sequential order, despite being saved by unordered
        // GUID in the database. This generates the next order number for new items.
        nextOrder: function () {
            if (!this.length) return 1;
            return this.last().get('order') + 1;
        },

        // Mappoints are sorted by their original insertion order.
        comparator: function (mappoint) {
            return mappoint.get('order');
        },

        // Find and return the mappoint at order
        getByOrder: function (order) {
            return this.filter(function (mappoint) {
                if (mappoint.get('order') == order) {
                    return true;
                }
                return false;
            });
        }

    });

    // Create our global collection of MapPoints.
    var MapPoints = new MapPointList;

    // MapPoint Item View
    // --------------
    var MapPointView = Backbone.View.extend({

        tagName: "li",

        // Cache the template function for a single item.
        template: _.template($('#item-template').html()),

        // The DOM events specific to an item.
        events: {
            "click a.destroy": "clear",
        },

        // The MapPointView listens for changes to its model, re-rendering. Since there's
        // a one-to-one correspondence between a **MapPoint** and a **MapPointView** in this
        // app, we set a direct reference on the model for convenience.
        initialize: function () {
            this.listenTo(this.model, 'change', this.render);
            this.listenTo(this.model, 'destroy', this.remove);
        },

        // Re-render the titles of the mappoint item.
        render: function () {
            this.$el.html(this.template(this.model.toJSON()));
            this.input = this.$('.edit');
            return this;
        },

        // Remove the item, destroy the model.
        clear: function () {
            var order = this.model.get('order');
            _.invoke(Map.removePinAtOrder(order));

            // Now update the text on the pins for all pins higher than that.
            MapPoints.each(function (mappoint) {
                var thisOrder = mappoint.get('order');
                if (thisOrder > order) {
                    _.invoke(Map.removePinAtOrder(thisOrder));
                    mappoint.set({
                        'order': thisOrder - 1
                    });
                    mappoint.save();
                    _.invoke(Map.drawPin(mappoint));
                }
            });

            this.model.destroy();
	    _.invoke(Map.drawAllPoly());
        }

    });

    // Map View (Where Map Events are handled)
    // --------------

    // The DOM element for a map item...
    var MapView = Backbone.View.extend({

        map: null,
	polylines: null,
	pushpins: null,
	polygons: null,
	onPolygon: false,
	onPolyline: false,

        initialize: function () {
            _.bindAll(this, 'createMap', 'createPin', 'drawPin', 'removePin', 'createPushPinOptions', 'removePinAtOrder', 'updatePinLocation', 'drawAllPoly', 'drawPolygon', 'turnPolygon', 'turnLine', 'turnPoint');
            Microsoft.Maps.loadModule('Microsoft.Maps.Themes.BingTheme', {
                callback: this.createMap
            });
        },

        createMap: function () {
            var mapOptions = {
                credentials: "Ak1rkb9n2fQoGB4ivK9CCvZHbqsKf_7dicMjbIDPJgZ72IEw8pG8qzIx21Ad1Y3B",
                center: new Microsoft.Maps.Location(47.5, -122.3),
                mapTypeId: Microsoft.Maps.MapTypeId.road,
                zoom: 7,
                theme: new Microsoft.Maps.Themes.BingTheme()
            };

            var bingMap = new Microsoft.Maps.Map(document.getElementById("mapDiv"), mapOptions);
            this.map = bingMap;

	    // Setup Bing pushpin collection
	    var pushpins = new Microsoft.Maps.EntityCollection();
	    this.pushpins = pushpins;

	    // Setup Bing polyline collection
	    var polylines = new Microsoft.Maps.EntityCollection();
	    this.polylines = polylines;
	    
	    // Setup Bing polygon collection
	    var polygons = new Microsoft.Maps.EntityCollection();
	    this.polygons = polygons;

            // Draw all points already in the list
            MapPoints.each(this.drawPin, this);
	    this.map.entities.push(this.pushpins);

            // All Map Events Will Be Defined Here
            Microsoft.Maps.Events.addHandler(this.map, 'click', this.createPin);

	    // Set initial state based on the value of type-selector and draw polylines or shapes
	    $type = $("#type-selector").val()
	    switch($type)
	    {
	    case "point":
		this.turnPoint();
		break;
	    case "line":
		this.turnLine();
		break;
	    case "shape":
		this.turnPolygon();
		break;
	    }
        },
	
	turnPoint: function() {
	    this.onPolygon = false;
	    this.onPolyline = false;
	    this.polygons.clear();
	    this.polylines.clear();
	},

	turnLine: function() {
	    this.onPolyline = true;
	    this.onPolygon = false;
	    this.polygons.clear();
	    this.drawAllPoly();
	},

	turnPolygon: function() {
	    this.onPolygon = true;
	    this.onPolyline = true;
	    this.drawAllPoly();
	},
	
	drawPolygon: function() {
	    this.polygons.clear();

	    var collection = this.pushpins;
            var len = collection.getLength(),
                entity;
	    var vertices = [];
	    for (var i = 0; i < len; i++) {
                vertices[i] = collection.get(i).getLocation();
            }
	    // add final pushpin as first puspin
	    vertices[len] = collection.get(0).getLocation()

	    var polygoncolor = new Microsoft.Maps.Color(60, 70, 215, 255);
            var polygon = new Microsoft.Maps.Polygon(vertices, {fillColor: polygoncolor, strokeColor: polygoncolor});
	    this.polygons.push(polygon);

            // Add the shape to the map
            this.map.entities.push(this.polygons);
	},

	drawPoly: function(pin1, pin2) {
	    latlon1 = pin1.getLocation();
	    latlon2 = pin2.getLocation();

	    var options = {strokeColor:new Microsoft.Maps.Color(200, 70, 215, 255), strokeThickness:5}; 

	    var polyline = new Microsoft.Maps.Polyline([
		new Microsoft.Maps.Location(latlon1.latitude, latlon1.longitude),
		new Microsoft.Maps.Location(latlon2.latitude, latlon2.longitude)
	    ], options);
	    this.polylines.push(polyline);
	},

	drawAllPoly: function() {
	    if(this.onPolyline){
		this.polylines.clear();

		var collection = this.pushpins;
		var len = collection.getLength(),
                entity;
		
		var prev = collection.get(0);

		for (var i = 0; i < len; i++) {
                    entity = collection.get(i);
		    this.drawPoly(prev, entity);
		    prev = entity;
		    
		    // Draw final connecting polyline if onPolygon and last element
		    if(i == len-1 && this.onPolygon){
			this.drawPoly(entity, collection.get(0));
		    }
		}

		// If onPolygon, draw the Polygon
		if(this.onPolygon){
		    this.drawPolygon();
		}
		this.map.entities.push(this.polylines);
	    }
	},

        updatePinLocation: function (e) {
            pushpin = e.entity;
            var order = parseInt(pushpin.getText());

            var found = MapPoints.find(function (mappoint) {
                return mappoint.get('order') === order;
            });

            found.set({
                'title': pushpin.getLocation()
            });
            found.save();

	    this.drawAllPoly();
        },
	
	createPin: function (e) {
            if (e.targetType == "map") {
                var point = new Microsoft.Maps.Point(e.getX(), e.getY());
                var loc = e.target.tryPixelToLocation(point);
                var location = new Microsoft.Maps.Location(loc.latitude, loc.longitude);

                // Add a MapPoints item at this location
                mappoint = MapPoints.create({
                    title: location
                });

		// Draw new pin, Draw new polylines
		this.drawPin(mappoint);

		this.map.entities.push(this.pushpins);
		this.drawAllPoly();
            }
        },

        // used for drawing new pins
        drawPin: function (mappoint) {
            var pin = new Microsoft.Maps.Pushpin(mappoint.get('title'), this.createPushPinOptions(mappoint.get('order').toString()));
            Microsoft.Maps.Events.addHandler(pin, 'rightclick', this.removePin);
            Microsoft.Maps.Events.addHandler(pin, 'dragend', this.updatePinLocation);

	    this.pushpins.push(pin);
        },

        createPushPinOptions: function (id) {
            var pushpinOptions = {
                text: id,
                visible: true,
                draggable: true
            };
            return pushpinOptions;
        },

        removePin: function (e) {
            if (e.targetType == "pushpin") {
                var indexOfPinToRemove = this.pushpins.indexOf(e.target);
                var pushpin = this.pushpins.get(indexOfPinToRemove);
                var order = parseInt(pushpin.getText());

                _.invoke(MapPoints.getByOrder(order), 'destroy');
                this.pushpins.removeAt(indexOfPinToRemove);
		
		// If we removed the first element, reset description and type to new number 1 (order 2)
		if(order == 1){
		    var found = MapPoints.find(function (mappoint) {
			return mappoint.get('order') === 2;
		    });
		    if (found){
			found.set({"description": $("#new-mapinfo").val(), "type": $("#type-selector").val()});
			found.save();
		    }
		}

                // Now update the text on the pins for all pins higher than that.
                MapPoints.each(function (mappoint) {
                    var thisOrder = mappoint.get('order');
                    if (thisOrder > order) {
                        _.invoke(Map.removePinAtOrder(thisOrder));
                        mappoint.set({
                            'order': thisOrder - 1
                        });
                        mappoint.save();
                        _.invoke(Map.drawPin(mappoint));
                    }
                });

		this.drawAllPoly();
            }
        },

        removePinAtOrder: function (order) {
            var collection = this.pushpins;
            var len = collection.getLength(),
                entity;

            for (var i = 0; i < len; i++) {
                entity = collection.get(i);
                if (entity.getText() == order) {
                    var indexOfPinToRemove = this.pushpins.indexOf(entity);
                    this.pushpins.removeAt(indexOfPinToRemove);
		    
		    // If we removed the first element, reset description and type to new number 1 (order 2)
		    if(order == 1){
			var found = MapPoints.find(function (mappoint) {
			    return mappoint.get('order') === 2;
			});
			if (found){
			    found.set({"description": $("#new-mapinfo").val(), "type": $("#type-selector").val()});
			    found.save();
			}
		    }

                    break;
                }
            }
        }

    });

    var Map = new MapView;

    // The Application
    // ---------------

    // Our overall **AppView** is the top-level piece of UI.
    var AppView = Backbone.View.extend({

        // Instead of generating a new element, bind to the existing skeleton of
        // the App already present in the HTML.
        el: $("#mappointapp"),

        // Our template for the line of statistics at the bottom of the app.
        statsTemplate: _.template($('#stats-template').html()),

        // Delegated events for creating new items, and clearing completed ones.
        events: {
	    "change #type-selector": "typeSelector",
            "blur #new-mapinfo": "create",
	    "keypress #new-mapinfo": "createOnEnter",
        },

        // At initialization we bind to the relevant events on the `MapPoints`
        // collection, when items are added or changed. Kick things off by
        // loading any preexisting mappoints that might be saved in *localStorage*.
        initialize: function () {

            this.input = this.$("#new-mapinfo");
	    this.type = this.$("#type-selector");

            this.listenTo(MapPoints, 'add', this.addOne);
            this.listenTo(MapPoints, 'reset', this.addAll);
            this.listenTo(MapPoints, 'all', this.render);

            this.footer = this.$('footer');
            this.main = $('#main');

            MapPoints.fetch();

	    // If there are already MapPoints, render the description and type
	    if (MapPoints.length) {
		var found = MapPoints.find(function (mappoint) {
                    return mappoint.get('order') === 1;
		});
		this.input.val(found.get("description"));
		this.type.val(found.get("type"));
	    }
        },

	typeSelector: function(e) {
	    $type = $(e.currentTarget).val()
	    
	    var found = MapPoints.find(function (mappoint) {
                return mappoint.get('order') === 1;
            });
	    if (found){
		found.set({"type": $type});
		found.save();
	    }

	    switch($type) {
	    case 'point':
		_.invoke(Map.turnPoint());
		break;
	    case 'line':
		_.invoke(Map.turnLine());
		break;
	    case 'shape':
		_.invoke(Map.turnPolygon());
		break;
	    }
	},

        // Re-rendering the App just means refreshing the statistics -- the rest
        // of the app doesn't change.
        render: function () {
            var done = MapPoints.done().length;
            var remaining = MapPoints.remaining().length;

            if (MapPoints.length) {
                this.main.show();
                this.footer.show();
                this.footer.html(this.statsTemplate({
                    done: done,
                    remaining: remaining
                }));
            } else {
                this.main.hide();
                this.footer.hide();
            }

        },

        // Add a single mappoint item to the list by creating a view for it, and
        // appending its element to the `<ul>`.
        addOne: function (mappoint) {
            var view = new MapPointView({
                model: mappoint
            });
            this.$("#mappoint-list").append(view.render().el);
        },

        // Add all items in the **MapPoints** collection at once.
        addAll: function () {
            MapPoints.each(this.addOne, this);
        },

	create: function() {
	    var found = MapPoints.find(function (mappoint) {
                return mappoint.get('order') === 1;
            });
	    found.set({"description": this.input.val()});
	    found.save();
	},

        // If you hit return in the main input field, create new **MapPoint** model,
        // persisting it to *localStorage*.
        createOnEnter: function (e) {
            if (e.keyCode != 13) return;
	    this.create();
	    this.input.blur();
        },

    });

    // Finally, we kick things off by creating the **App**.
    var App = new AppView;

});