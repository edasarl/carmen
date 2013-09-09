// v8
#include <v8.h>

// node
#include <node.h>
#include <node_object_wrap.h>
#include <node_version.h>
#include <node_buffer.h>

// stl
#include <iostream>
#include <exception>
#include <string>
#include <map>
#include <vector>

#include <nan.h>
#include "pbf.hpp"
#include "index.pb.h"

// now set (or not) in binding.gyp
//#define USE_LAZY_PROTO_CACHE
//#define USE_CXX11

// TODO
// - add ability to materialize lazy cache or just simplify and only use lazy cache
// - does capnproto expose ability to get raw bytes of item?
// - why is string_ref not faster?
// - why is std::map faster than std::unordered on OS X?

namespace binding {

using namespace v8;

typedef uint64_t int_type;

// lazy ref item
//#include <boost/utility/string_ref.hpp>
//typedef boost::string_ref string_ref_type;
typedef std::string string_ref_type;
typedef std::map<int_type,string_ref_type> larraycache;
typedef larraycache::const_iterator larraycache_iterator;
typedef std::map<std::string,larraycache> lazycache;
typedef lazycache::const_iterator lazycache_iterator_type;

// fully cached item
typedef std::vector<int_type> intarray;
typedef std::vector<intarray> varray;
typedef std::map<int_type,varray> arraycache;
typedef arraycache::const_iterator arraycache_iterator;
typedef std::map<std::string,arraycache> memcache;
typedef memcache::const_iterator mem_iterator_type;

class Cache: public node::ObjectWrap {
public:
    static Persistent<FunctionTemplate> constructor;
    static void Initialize(Handle<Object> target);
    static NAN_METHOD(New);
    static NAN_METHOD(has);
    static NAN_METHOD(load);
    static NAN_METHOD(loadJSON);
    static NAN_METHOD(search);
    static NAN_METHOD(pack);
    static NAN_METHOD(list);
    static NAN_METHOD(set);
    static void AsyncRun(uv_work_t* req);
    static void AfterRun(uv_work_t* req);
    Cache(std::string const& id, int shardlevel);
    void _ref() { Ref(); }
    void _unref() { Unref(); }
private:
    ~Cache();
    std::string id_;
    int shardlevel_;
    memcache cache_;
    lazycache lazy_;
};

Persistent<FunctionTemplate> Cache::constructor;

void Cache::Initialize(Handle<Object> target) {
    NanScope();
    Local<FunctionTemplate> t = FunctionTemplate::New(Cache::New);
    t->InstanceTemplate()->SetInternalFieldCount(1);
    t->SetClassName(String::NewSymbol("Cache"));
    NODE_SET_PROTOTYPE_METHOD(t, "has", has);
    NODE_SET_PROTOTYPE_METHOD(t, "load", load);
    NODE_SET_PROTOTYPE_METHOD(t, "loadJSON", loadJSON);
    NODE_SET_PROTOTYPE_METHOD(t, "search", search);
    NODE_SET_PROTOTYPE_METHOD(t, "pack", pack);
    NODE_SET_PROTOTYPE_METHOD(t, "list", list);
    NODE_SET_PROTOTYPE_METHOD(t, "_set", set);
    target->Set(String::NewSymbol("Cache"),t->GetFunction());
    NanAssignPersistent(FunctionTemplate, constructor, t);
}

Cache::Cache(std::string const& id, int shardlevel)
  : ObjectWrap(),
    id_(id),
    shardlevel_(shardlevel),
    cache_(),
    lazy_()
    { }

Cache::~Cache() { }

NAN_METHOD(Cache::pack)
{
    NanScope();
    if (args.Length() < 2) {
        return NanThrowTypeError("expected three args: 'type','shard','encoding'");
    }
    if (!args[0]->IsString()) {
        return NanThrowTypeError("first argument must be a string");
    }
    if (!args[1]->IsNumber()) {
        return NanThrowTypeError("second arg must be an integer");
    }
    std::string encoding("protobuf");
    if (args.Length() > 2) {
        if (!args[2]->IsString()) {
            return NanThrowTypeError("third arg must be a string");
        }
        encoding = *String::Utf8Value(args[2]->ToString());
        if (encoding != "protobuf") {
            return NanThrowTypeError((std::string("invalid encoding: ")+ encoding).c_str());
        }
    }
    try {
        std::string type = *String::Utf8Value(args[0]->ToString());
        std::string shard = *String::Utf8Value(args[1]->ToString());
        std::string key = type + "-" + shard;
        Cache* c = node::ObjectWrap::Unwrap<Cache>(args.This());
        memcache const& mem = c->cache_;
        mem_iterator_type itr = mem.find(key);
        carmen::proto::object msg;
        if (itr != mem.end()) {
            arraycache_iterator aitr = itr->second.begin();
            arraycache_iterator aend = itr->second.end();
            while (aitr != aend) {
                ::carmen::proto::object_item * new_item = msg.add_items(); 
                new_item->set_key(aitr->first);
                varray const & varr = aitr->second;
                unsigned varr_size = varr.size();
                for (unsigned i=0;i<varr_size;++i) {
                    ::carmen::proto::object_array * array = new_item->add_arrays();
                    intarray const& vals = varr[i];
                    for (unsigned j=0;j<vals.size();++j) {
                        array->add_val(vals[j]);
                    }
                }
                ++aitr;
            }
        } else {
            #ifdef USE_LAZY_PROTO_CACHE
            lazycache & lazy = c->lazy_;
            lazycache_iterator_type litr = lazy.begin();
            lazycache_iterator_type lend = lazy.end();
            while (litr != lend) {
                larraycache_iterator laitr = litr->second.begin();
                larraycache_iterator laend = litr->second.end();
                while (laitr != laend) {
                    ::carmen::proto::object_item * new_item = msg.add_items();
                    new_item->set_key(laitr->first);
                    string_ref_type const& ref = laitr->second;
                    protobuf::message item(ref.data(), ref.size());
                    while (item.next()) {
                        if (item.tag == 1) {
                            item.skip();
                        } else if (item.tag == 2) {
                            uint32_t arrays_length = item.varint();
                            protobuf::message pbfarray(item.data,arrays_length);
                            ::carmen::proto::object_array * new_array = new_item->add_arrays();
                            while (pbfarray.next()) {
                                if (pbfarray.tag == 1) {
                                    uint32_t vals_length = pbfarray.varint();
                                    protobuf::message val(pbfarray.data,vals_length);
                                    while (val.next()) {
                                        new_array->add_val(val.value);
                                    }
                                    pbfarray.skipBytes(vals_length);
                                } else {
                                    throw std::runtime_error("skipping when shouldnt");
                                    pbfarray.skip();
                                }
                            }
                            item.skipBytes(arrays_length);
                        } else {
                            throw std::runtime_error("hit unknown type");
                        }
                    }
                    ++laitr;
                }
                ++litr;
            }
            #else
            NanReturnValue(Undefined());                
            #endif
        }
        int size = msg.ByteSize();
        #if NODE_VERSION_AT_LEAST(0, 11, 0)
        Local<Object> retbuf = node::Buffer::New(size);
        if (msg.SerializeToArray(node::Buffer::Data(retbuf),size))
        {
            NanReturnValue(retbuf);
        }
        #else
        node::Buffer *retbuf = node::Buffer::New(size);
        if (msg.SerializeToArray(node::Buffer::Data(retbuf),size))
        {
            NanReturnValue(retbuf->handle_);
        }
        #endif
    } catch (std::exception const& ex) {
        return NanThrowTypeError(ex.what());
    }
    NanReturnValue(Undefined());
}

NAN_METHOD(Cache::list)
{
    NanScope();
    if (args.Length() < 1) {
        return NanThrowTypeError("expected at least one arg: 'type' + optional 'shard'");
    }
    if (!args[0]->IsString()) {
        return NanThrowTypeError("first argument must be a string");
    }
    try {
        std::string type = *String::Utf8Value(args[0]->ToString());
        Cache* c = node::ObjectWrap::Unwrap<Cache>(args.This());
        memcache & mem = c->cache_;
        Local<Array> ids = Array::New();
        if (args.Length() == 1) {
            mem_iterator_type itr = mem.begin();
            mem_iterator_type end = mem.end();
            unsigned idx = 0;
            while (itr != end) {
                if (itr->first.size() > type.size() && itr->first.substr(0,type.size()) == type) {
                    std::string shard = itr->first.substr(type.size()+1,itr->first.size());
                    ids->Set(idx++,Number::New(String::New(shard.c_str())->NumberValue()));
                }
                ++itr;
            }
            #ifdef USE_LAZY_PROTO_CACHE
            lazycache & lazy = c->lazy_;
            lazycache_iterator_type litr = lazy.begin();
            lazycache_iterator_type lend = lazy.end();
            while (litr != lend) {
                if (litr->first.size() > type.size() && litr->first.substr(0,type.size()) == type) {
                    std::string shard = litr->first.substr(type.size()+1,litr->first.size());
                    ids->Set(idx++,Number::New(String::New(shard.c_str())->NumberValue()));
                }
                ++litr;
            }
            #endif
            NanReturnValue(ids);
        } else if (args.Length() == 2) {
            std::string shard = *String::Utf8Value(args[1]->ToString());
            std::string key = type + "-" + shard;
            mem_iterator_type itr = mem.find(key);
            unsigned idx = 0;
            if (itr != mem.end()) {
                arraycache_iterator aitr = itr->second.begin();
                arraycache_iterator aend = itr->second.end();
                while (aitr != aend) {
                    ids->Set(idx++,Number::New(aitr->first)->ToString());
                    ++aitr;
                }
            }
            #ifdef USE_LAZY_PROTO_CACHE
            lazycache & lazy = c->lazy_;
            lazycache_iterator_type litr = lazy.find(key);
            if (litr != lazy.end()) {
                larraycache_iterator laitr = litr->second.begin();
                larraycache_iterator laend = litr->second.end();
                while (laitr != laend) {
                    ids->Set(idx++,Number::New(laitr->first)->ToString());
                    ++laitr;
                }
            }
            #endif
            NanReturnValue(ids);
        }
    } catch (std::exception const& ex) {
        return NanThrowTypeError(ex.what());
    }
    NanReturnValue(Undefined());
}

NAN_METHOD(Cache::set)
{
    NanScope();
    if (args.Length() < 3) {
        return NanThrowTypeError("expected three args: 'type','shard','id','data'");
    }
    if (!args[0]->IsString()) {
        return NanThrowTypeError("first argument must be a string");
    }
    if (!args[1]->IsNumber()) {
        return NanThrowTypeError("second arg must be an integer");
    }
    if (!args[2]->IsNumber()) {
        return NanThrowTypeError("third arg must be an integer");
    }
    if (!args[3]->IsArray()) {
        return NanThrowTypeError("fourth arg must be an array");
    }
    Local<Array> data = Local<Array>::Cast(args[3]);
    if (data->IsNull() || data->IsUndefined()) {
        return NanThrowTypeError("an array expected for third argument");
    }
    try {
        std::string type = *String::Utf8Value(args[0]->ToString());
        std::string shard = *String::Utf8Value(args[1]->ToString());
        std::string key = type + "-" + shard;
        Cache* c = node::ObjectWrap::Unwrap<Cache>(args.This());
        memcache & mem = c->cache_;
        mem_iterator_type itr = mem.find(key);
        if (itr == mem.end()) {
            c->cache_.insert(std::make_pair(key,arraycache()));    
        }
        arraycache & arrc = c->cache_[key];
        int_type key_id = args[2]->NumberValue();
        arraycache_iterator itr2 = arrc.find(key_id);
        if (itr2 == arrc.end()) {
            arrc.insert(std::make_pair(key_id,varray()));   
        }
        varray & vv = arrc[key_id];
        if (itr2 != arrc.end()) {
            vv.clear();
        }
        unsigned array_size = data->Length();
        vv.reserve(1);
        #ifdef USE_CXX11
        vv.emplace_back(intarray());
        #else
        vv.push_back(intarray());
        #endif
        intarray & vvals = vv.back();
        vvals.reserve(array_size);
        for (unsigned i=0;i<array_size;++i) {
            #ifdef USE_CXX11
            vvals.emplace_back(data->Get(i)->NumberValue());
            #else
            vvals.push_back(data->Get(i)->NumberValue());
            #endif
        }
    } catch (std::exception const& ex) {
        return NanThrowTypeError(ex.what());
    }
    NanReturnValue(Undefined());
}

NAN_METHOD(Cache::loadJSON)
{
    NanScope();
    if (args.Length() < 3) {
        return NanThrowTypeError("expected four args: 'object','type','shard'");
    }
    if (!args[0]->IsObject()) {
        return NanThrowTypeError("first argument must be an object");
    }
    Local<Object> obj = args[0]->ToObject();
    if (obj->IsNull() || obj->IsUndefined()) {
        return NanThrowTypeError("a valid object expected for first argument");
    }
    if (!args[1]->IsString()) {
        return NanThrowTypeError("second arg 'type' must be a string");
    }
    if (!args[2]->IsNumber()) {
        return NanThrowTypeError("third arg 'shard' must be an Integer");
    }
    try {
        std::string type = *String::Utf8Value(args[1]->ToString());
        std::string shard = *String::Utf8Value(args[2]->ToString());
        std::string key = type + "-" + shard;
        Cache* c = node::ObjectWrap::Unwrap<Cache>(args.This());
        memcache & mem = c->cache_;
        mem_iterator_type itr = mem.find(key);
        if (itr == mem.end()) {
            c->cache_.insert(std::make_pair(key,arraycache()));    
        }
        arraycache & arrc = c->cache_[key];
        v8::Local<v8::Array> propertyNames = obj->GetPropertyNames();
        uint32_t prop_len = propertyNames->Length();
        for (uint32_t i=0;i < prop_len;++i) {
            v8::Local<v8::Value> key = propertyNames->Get(i);
            v8::Local<v8::Value> prop = obj->Get(key);
            if (prop->IsArray()) {
                int_type key_id = key->NumberValue();
                arrc.insert(std::make_pair(key_id,varray()));
                varray & vv = arrc[key_id];
                v8::Local<v8::Array> arr = v8::Local<v8::Array>::Cast(prop);
                uint32_t arr_len = arr->Length();
                vv.reserve(1);
                #ifdef USE_CXX11
                vv.emplace_back(intarray());
                #else
                vv.push_back(intarray());
                #endif
                intarray & vvals = vv.back();
                vvals.reserve(arr_len);
                for (uint32_t j=0;j < arr_len;++j) {
                    v8::Local<v8::Value> val = arr->Get(j);
                    if (val->IsNumber()) {
                        #ifdef USE_CXX11
                        vvals.emplace_back(val->NumberValue());
                        #else
                        vvals.push_back(val->NumberValue());
                        #endif
                    }
                }
            }
        }
    } catch (std::exception const& ex) {
        return NanThrowTypeError(ex.what());
    }
    NanReturnValue(Undefined());
}

NAN_METHOD(Cache::load)
{
    NanScope();
    if (args.Length() < 3) {
        return NanThrowTypeError("expected four args: 'buffer','type','shard','encoding'");
    }
    if (!args[0]->IsObject()) {
        return NanThrowTypeError("first argument must be a buffer");
    }
    Local<Object> obj = args[0]->ToObject();
    if (obj->IsNull() || obj->IsUndefined()) {
        return NanThrowTypeError("a buffer expected for first argument");
    }
    if (!node::Buffer::HasInstance(obj)) {
        return NanThrowTypeError("first argument must be a buffer");
    }
    if (!args[1]->IsString()) {
        return NanThrowTypeError("second arg 'type' must be a string");
    }
    if (!args[2]->IsNumber()) {
        return NanThrowTypeError("third arg 'shard' must be an Integer");
    }
    try {
        std::string encoding("protobuf");
        if (args.Length() > 3) {
            // ignore undefined/null
            if (args[3]->IsString()) {
                encoding = *String::Utf8Value(args[3]->ToString());
                if (encoding != "protobuf") {
                    return NanThrowTypeError((std::string("invalid encoding: ")+ encoding).c_str());
                }
            }
        }
        const char * cdata = node::Buffer::Data(obj);
        size_t size = node::Buffer::Length(obj);
        std::string type = *String::Utf8Value(args[1]->ToString());
        std::string shard = *String::Utf8Value(args[2]->ToString());
        std::string key = type + "-" + shard;
        Cache* c = node::ObjectWrap::Unwrap<Cache>(args.This());
        memcache & mem = c->cache_;
        mem_iterator_type itr = mem.find(key);
        if (itr == mem.end()) {
            c->cache_.insert(std::make_pair(key,arraycache()));    
        }
        protobuf::message message(cdata,size);
        #ifdef USE_LAZY_PROTO_CACHE
        memcache::iterator itr2 = mem.find(key);
        if (itr2 != mem.end()) {
            mem.erase(itr2);
        }
        lazycache & lazy = c->lazy_;
        lazycache_iterator_type litr = lazy.find(key);
        if (litr == lazy.end()) {
            c->lazy_.insert(std::make_pair(key,larraycache()));    
        }
        larraycache & larrc = c->lazy_[key];
        while (message.next()) {
            if (message.tag == 1) {
                uint32_t bytes = message.varint();
                protobuf::message item(message.data, bytes);
                while (item.next()) {
                    if (item.tag == 1) {
                        int_type key_id = item.varint();
                        // NOTE: emplace is faster if using std::string
                        // if using boost::string_ref, std::move is faster
                        #ifdef USE_CXX11
                        larrc.insert(std::make_pair(key_id,std::move(string_ref_type((const char *)message.data,bytes))));
                        #else
                        larrc.insert(std::make_pair(key_id,string_ref_type((const char *)message.data,bytes)));
                        #endif
                    } else {
                        break;
                    }
                }
                message.skipBytes(bytes);
            } else {
                throw std::runtime_error("skipping when shouldnt");
                message.skip();
            }
        }
        #else
        arraycache & arrc = c->cache_[key];
        while (message.next()) {
            if (message.tag == 1) {
                uint32_t bytes = message.varint();
                protobuf::message item(message.data, bytes);
                int_type key_id = 0;
                while (item.next()) {
                    if (item.tag == 1) {
                        key_id = item.varint();
                        arrc.insert(std::make_pair(key_id,varray()));
                    } else if (item.tag == 2) {
                        if (key_id == 0) throw std::runtime_error("key_id not initialized!");
                        varray & vv = arrc[key_id];
                        uint32_t arrays_length = item.varint();
                        protobuf::message array(item.data,arrays_length);
                        while (array.next()) {
                            if (array.tag == 1) {
                                #ifdef USE_CXX11
                                vv.emplace_back(intarray());
                                #else
                                vv.push_back(intarray());
                                #endif
                                intarray & vvals = vv.back();
                                uint32_t vals_length = array.varint();
                                protobuf::message val(array.data,vals_length);
                                while (val.next()) {
                                    #ifdef USE_CXX11
                                    vvals.emplace_back(val.value);
                                    #else
                                    vvals.push_back(val.value);
                                    #endif
                                }
                                array.skipBytes(vals_length);
                            } else {
                                throw std::runtime_error("skipping when shouldnt");
                                array.skip();
                            }
                        }
                        item.skipBytes(arrays_length);
                    } else {
                        throw std::runtime_error("hit unknown type");
                    }
                }
                message.skipBytes(bytes);
            } else {
                throw std::runtime_error("skipping when shouldnt");
                message.skip();
            }
        }
        #endif
    } catch (std::exception const& ex) {
        return NanThrowTypeError(ex.what());
    }
    NanReturnValue(Undefined());
}


NAN_METHOD(Cache::has)
{
    NanScope();
    if (args.Length() < 2) {
        return NanThrowTypeError("expected two args: type and shard");
    }
    if (!args[0]->IsString()) {
        return NanThrowTypeError("first arg must be a string");
    }
    if (!args[1]->IsNumber()) {
        return NanThrowTypeError("second arg must be an integer");
    }
    try {
        std::string type = *String::Utf8Value(args[0]->ToString());
        std::string shard = *String::Utf8Value(args[1]->ToString());
        std::string key = type + "-" + shard;
        Cache* c = node::ObjectWrap::Unwrap<Cache>(args.This());
        memcache const& mem = c->cache_;
        mem_iterator_type itr = mem.find(key);
        if (itr != mem.end()) {
            NanReturnValue(True());
        } else {
            #ifdef USE_LAZY_PROTO_CACHE
            lazycache const& lazy = c->lazy_;
            lazycache_iterator_type litr = lazy.find(key);
            if (litr != lazy.end()) {
                NanReturnValue(True());
            }
            #endif
            NanReturnValue(False());
        }
    } catch (std::exception const& ex) {
        return NanThrowTypeError(ex.what());
    }
}

NAN_METHOD(Cache::search)
{
    NanScope();
    if (args.Length() < 3) {
        return NanThrowTypeError("expected two args: type, shard, and id");
    }
    if (!args[0]->IsString()) {
        return NanThrowTypeError("first arg must be a string");
    }
    if (!args[1]->IsNumber()) {
        return NanThrowTypeError("second arg must be an integer");
    }
    if (!args[2]->IsNumber()) {
        return NanThrowTypeError("third arg must be an integer");
    }
    try {
        std::string type = *String::Utf8Value(args[0]->ToString());
        std::string shard = *String::Utf8Value(args[1]->ToString());
        int_type id = args[2]->NumberValue();
        std::string key = type + "-" + shard;
        Cache* c = node::ObjectWrap::Unwrap<Cache>(args.This());
        memcache & mem = c->cache_;
        mem_iterator_type itr = mem.find(key);
        if (itr == mem.end()) {
            #ifdef USE_LAZY_PROTO_CACHE
            lazycache const& lazy = c->lazy_;
            lazycache_iterator_type litr = lazy.find(key);
            if (litr == lazy.end()) {
                NanReturnValue(Undefined());
            }
            larraycache_iterator laitr = litr->second.find(id);
            if (laitr == litr->second.end()) {
                NanReturnValue(Undefined());
            } else {
                varray array; // TODO - reserve
                string_ref_type const& ref = laitr->second;
                protobuf::message item(ref.data(), ref.size());
                while (item.next()) {
                    if (item.tag == 1) {
                        item.skip();
                    } else if (item.tag == 2) {
                        uint32_t arrays_length = item.varint();
                        protobuf::message pbfarray(item.data,arrays_length);
                        while (pbfarray.next()) {
                            if (pbfarray.tag == 1) {
                                #ifdef USE_CXX11
                                array.emplace_back(intarray());
                                #else
                                array.push_back(intarray());
                                #endif
                                intarray & vvals = array.back();
                                uint32_t vals_length = pbfarray.varint();
                                protobuf::message val(pbfarray.data,vals_length);
                                while (val.next()) {
                                    #ifdef USE_CXX11
                                    vvals.emplace_back(val.value);
                                    #else
                                    vvals.push_back(val.value);
                                    #endif
                                }
                                pbfarray.skipBytes(vals_length);
                            } else {
                                throw std::runtime_error("skipping when shouldnt");
                                pbfarray.skip();
                            }
                        }
                        item.skipBytes(arrays_length);
                    } else {
                        throw std::runtime_error("hit unknown type");
                    }
                }
                intarray arr = array[0];
                unsigned vals_size = arr.size();
                Local<Array> arr_obj = Array::New(vals_size);
                for (unsigned k=0;k<vals_size;++k) {
                    arr_obj->Set(k,Number::New(arr[k]));
                }
                NanReturnValue(arr_obj);
            }
            #else
            NanReturnValue(Undefined());
            #endif
        } else {
            arraycache_iterator aitr = itr->second.find(id);
            if (aitr == itr->second.end()) {
                NanReturnValue(Undefined());
            } else {
                varray const& array = aitr->second;
                intarray arr = array[0];
                unsigned vals_size = arr.size();
                Local<Array> arr_obj = Array::New(vals_size);
                for (unsigned k=0;k<vals_size;++k) {
                    arr_obj->Set(k,Number::New(arr[k]));
                }
                NanReturnValue(arr_obj);
            }
        }
    } catch (std::exception const& ex) {
        return NanThrowTypeError(ex.what());
    }
}

NAN_METHOD(Cache::New)
{
    NanScope();
    if (!args.IsConstructCall()) {
        return NanThrowTypeError("Cannot call constructor as function, you need to use 'new' keyword");
    }
    try {
        if (args.Length() < 2) {
            return NanThrowTypeError("expected 'id' and 'shardlevel' arguments");
        }
        if (!args[0]->IsString()) {
            return NanThrowTypeError("first argument 'id' must be a string");
        }
        if (!args[1]->IsNumber()) {
            return NanThrowTypeError("first argument 'shardlevel' must be a number");
        }
        std::string id = *String::Utf8Value(args[0]->ToString());
        int shardlevel = args[1]->IntegerValue();
        Cache* im = new Cache(id,shardlevel);
        im->Wrap(args.This());
        args.This()->Set(String::NewSymbol("id"),args[0]);
        args.This()->Set(String::NewSymbol("shardlevel"),args[1]);
        NanReturnValue(args.This());
    } catch (std::exception const& ex) {
        return NanThrowTypeError(ex.what());
    }
    NanReturnValue(Undefined());
}

extern "C" {
    static void start(Handle<Object> target) {
        Cache::Initialize(target);
    }
}

} // namespace binding

NODE_MODULE(binding, binding::start)