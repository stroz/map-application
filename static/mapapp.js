// Uses local storage to persist models within your browser (for now).
// This will be uncoupled and connected to the server to persist models in the database
// Load the application once the DOM is ready, using `jQuery.ready`:
$(function () {

    // Todo Model ----------

    // Our basic **Todo** model has `title`, `order`, and `done` attributes.
    var Todo = Backbone.Model.extend({

        // Default attributes for the todo item.
        defaults: function () {
            return {
                title: "display point...",
                pin_index: 0,
                order: Todos.nextOrder(),
                done: false
            };
        },

        // Ensure that each todo created has `title`.
        initialize: function () {
            if (!this.get("title")) {
                this.set({
                    "title": this.defaults().title
                });
            }
        },

        // Toggle the `done` state of this todo item.
        toggle: function () {
            this.save({
                done: !this.get("done")
            });
        }

    });

    // Todo Collection
    // ---------------

    // The collection of todos is backed by *localStorage* instead of a remote
    // server.
    var TodoList = Backbone.Collection.extend({

        // Reference to this collection's model.
        model: Todo,

        // Save all of the todo items under the `"todos-backbone"` namespace.
        localStorage: new Backbone.LocalStorage("todos-backbone"),

        // Filter down the list of all todo items that are finished.
        done: function () {
            return this.filter(function (todo) {
                return todo.get('done');
            });
        },

        // Filter down the list to only todo items that are still not finished.
        remaining: function () {
            return this.without.apply(this, this.done());
        },

        // We keep the Todos in sequential order, despite being saved by unordered
        // GUID in the database. This generates the next order number for new items.
        nextOrder: function () {
            if (!this.length) return 1;
            return this.last().get('order') + 1;
        },

        // Todos are sorted by their original insertion order.
        comparator: function (todo) {
            return todo.get('order');
        },

        // Find and return the todo at order
        getByOrder: function (order) {
            return this.filter(function (todo) {
                if (todo.get('order') == order) {
                    return true;
                }
                return false;
            });
        }

    });

    // Create our global collection of **Todos**.
    var Todos = new TodoList;

    // Todo Item View
    // --------------

    // The DOM element for a todo item...
    var TodoView = Backbone.View.extend({

        //... is a list tag.
        tagName: "li",

        // Cache the template function for a single item.
        template: _.template($('#item-template').html()),

        // The DOM events specific to an item.
        events: {
            "click .toggle": "toggleDone",
            "dblclick .view": "edit",
            "click a.destroy": "clear",
            "keypress .edit": "updateOnEnter",
            "blur .edit": "close"
        },

        // The TodoView listens for changes to its model, re-rendering. Since there's
        // a one-to-one correspondence between a **Todo** and a **TodoView** in this
        // app, we set a direct reference on the model for convenience.
        initialize: function () {
            this.listenTo(this.model, 'change', this.render);
            this.listenTo(this.model, 'destroy', this.remove);
        },

        // Re-render the titles of the todo item.
        render: function () {
            this.$el.html(this.template(this.model.toJSON()));
            this.$el.toggleClass('done', this.model.get('done'));
            this.input = this.$('.edit');
            return this;
        },

        // Toggle the `"done"` state of the model.
        toggleDone: function () {
            this.model.toggle();
        },

        // Switch this view into `"editing"` mode, displaying the input field.
        edit: function () {
            this.$el.addClass("editing");
            this.input.focus();
        },

        // Close the `"editing"` mode, saving changes to the todo.
        close: function () {
            var value = this.input.val();
            if (!value) {
                this.clear();
            } else {
                this.model.save({
                    title: value
                });
                this.$el.removeClass("editing");
            }
        },

        // If you hit `enter`, we're through editing the item.
        updateOnEnter: function (e) {
            if (e.keyCode == 13) this.close();
        },

        // Remove the item, destroy the model.
        clear: function () {
            var order = this.model.get('order');
            _.invoke(Map.removePinAtOrder(order));

            // Now update the text on the pins for all pins higher than that.
            Todos.each(function (todo) {
                var thisOrder = todo.get('order');
                if (thisOrder > order) {
                    //.removePinAtOrder(thisOrder);
                    //alert("got here");
                    _.invoke(Map.removePinAtOrder(thisOrder));
                    todo.set({
                        'order': thisOrder - 1
                    });
                    todo.save();
                    _.invoke(Map.drawPin(todo));
                    //this.drawPin(todo);
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

        initialize: function () {
            _.bindAll(this, 'createMap', 'createPin', 'drawPin', 'removePin', 'createPushPinOptions', 'removePinAtOrder', 'updatePinLocation', 'drawAllPoly');
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
            // Draw all points already in the list
            Todos.each(this.drawPin, this);

            // All Map Events Will Be Defined Here
            Microsoft.Maps.Events.addHandler(this.map, 'click', this.createPin);

	    // Setup Bing polyline collection
	    var polylines = new Microsoft.Maps.EntityCollection();
	    this.polylines = polylines;

	    this.drawAllPoly();

        },

        createPin: function (e) {
            if (e.targetType == "map") {
                var point = new Microsoft.Maps.Point(e.getX(), e.getY());
                var loc = e.target.tryPixelToLocation(point);
                var location = new Microsoft.Maps.Location(loc.latitude, loc.longitude);

                // Add a Todos item at this location
                todo = Todos.create({
                    title: location
                });

                var pin = new Microsoft.Maps.Pushpin(location, this.createPushPinOptions(todo.get('order').toString()));
                Microsoft.Maps.Events.addHandler(pin, 'rightclick', this.removePin);
                Microsoft.Maps.Events.addHandler(pin, 'dragend', this.updatePinLocation);

                this.map.entities.push(pin);
		this.drawAllPoly();
            }
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
	    this.polylines.clear();

	    var collection = this.map.entities;
            var len = collection.getLength(),
                entity;

	    var prev = collection.get(0);
            for (var i = 0; i < len; i++) {
                entity = collection.get(i);
                if (entity['getText']) {
		    this.drawPoly(prev, entity);
		    prev = entity;
                }
            }

	    this.map.entities.push(this.polylines);
	},

        updatePinLocation: function (e) {
            pushpin = e.entity;
            var order = parseInt(pushpin.getText());

            var found = Todos.find(function (todo) {
                return todo.get('order') === order;
            });

            found.set({
                'title': pushpin.getLocation()
            });
            found.save();

            //alert(found.get('order'));
	    this.drawAllPoly();
        },

        // used for drawing new pins
        drawPin: function (todo) {
            var pin = new Microsoft.Maps.Pushpin(todo.get('title'), this.createPushPinOptions(todo.get('order').toString()));
            Microsoft.Maps.Events.addHandler(pin, 'rightclick', this.removePin);
            Microsoft.Maps.Events.addHandler(pin, 'dragend', this.updatePinLocation);

            this.map.entities.push(pin);
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
                var indexOfPinToRemove = this.map.entities.indexOf(e.target);

                var pushpin = this.map.entities.get(indexOfPinToRemove);
                var order = parseInt(pushpin.getText());

                _.invoke(Todos.getByOrder(order), 'destroy');
                this.map.entities.removeAt(indexOfPinToRemove);

                // Now update the text on the pins for all pins higher than that.
                Todos.each(function (todo) {
                    var thisOrder = todo.get('order');
                    if (thisOrder > order) {
                        _.invoke(Map.removePinAtOrder(thisOrder));
                        todo.set({
                            'order': thisOrder - 1
                        });
                        todo.save();
                        _.invoke(Map.drawPin(todo));
                    }
                });
		this.drawAllPoly();
            }
        },

        removePinAtOrder: function (order) {
            var collection = this.map.entities;
            var len = collection.getLength(),
                entity;

            for (var i = 0; i < len; i++) {
                entity = collection.get(i);
                if (entity['getText'] && entity.getText() == order) {
                    //var text = entity.getText();
                    //alert(text);
                    var indexOfPinToRemove = this.map.entities.indexOf(entity);
                    //alert(indexOfPinToRemove);
                    this.map.entities.removeAt(indexOfPinToRemove);
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
        el: $("#todoapp"),

        // Our template for the line of statistics at the bottom of the app.
        statsTemplate: _.template($('#stats-template').html()),

        // Delegated events for creating new items, and clearing completed ones.
        events: {
            "keypress #new-todo": "createOnEnter",
            "click #clear-completed": "clearCompleted",
            "click #toggle-all": "toggleAllComplete"
        },

        // At initialization we bind to the relevant events on the `Todos`
        // collection, when items are added or changed. Kick things off by
        // loading any preexisting todos that might be saved in *localStorage*.
        initialize: function () {

            this.input = this.$("#new-todo");
            this.allCheckbox = this.$("#toggle-all")[0];

            this.listenTo(Todos, 'add', this.addOne);
            this.listenTo(Todos, 'reset', this.addAll);
            this.listenTo(Todos, 'all', this.render);

            this.footer = this.$('footer');
            this.main = $('#main');

            Todos.fetch();
        },

        // Re-rendering the App just means refreshing the statistics -- the rest
        // of the app doesn't change.
        render: function () {
            var done = Todos.done().length;
            var remaining = Todos.remaining().length;

            if (Todos.length) {
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

            this.allCheckbox.checked = !remaining;
        },

        // Add a single todo item to the list by creating a view for it, and
        // appending its element to the `<ul>`.
        addOne: function (todo) {
            var view = new TodoView({
                model: todo
            });
            this.$("#todo-list").append(view.render().el);
        },

        // Add all items in the **Todos** collection at once.
        addAll: function () {
            Todos.each(this.addOne, this);
        },

        // If you hit return in the main input field, create new **Todo** model,
        // persisting it to *localStorage*.
        createOnEnter: function (e) {
            if (e.keyCode != 13) return;
            if (!this.input.val()) return;

            Todos.create({
                title: this.input.val()
            });
            this.input.val('');
        },

        // Clear all done todo items, destroying their models.
        clearCompleted: function () {
            _.invoke(Todos.done(), 'destroy');
            return false;
        },

        toggleAllComplete: function () {
            var done = this.allCheckbox.checked;
            Todos.each(function (todo) {
                todo.save({
                    'done': done
                });
            });
        }

    });

    // Finally, we kick things off by creating the **App**.
    var App = new AppView;

});