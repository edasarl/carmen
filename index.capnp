# unique file ID, generated by `capnp id`
@0xdf41ce6e36d15bd6;


using Cxx = import "/capnp/c++.capnp";
$Cxx.namespace("carmen");

struct Array {
  val @0 :List(UInt64);
}

struct Item {
  arrays @0:List(Array);
  key @1:UInt64;
}

struct Message {
  items @0:List(Item);	
}